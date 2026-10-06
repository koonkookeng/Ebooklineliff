// SSOT Phase 015 §5.2/§7.1/§10 — Order atomic outbox + slip retry worker
// Canonical: apps/backend/src/modules/order/services/order-atomic.service.ts
// (legacy src/backend/modules/order/services/order-atomic.service.ts)
// Outbox rows are the durability record for post-commit fan-out; the
// dispatcher publishes each row once to `stream:outbox:<eventType>` and marks
// it processed. Retry rows (SLIP_VERIFY_RETRY) re-drive verification after
// provider outages (spec §10: reprocess within 30s, max 3 attempts).
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  SlipAtomicResponseSchema,
  SlipRetryJobSchema,
  type OutboxEventType,
} from '@repo/shared';

export const RETRY_DELAY_MS = 30_000;

type TxOutbox = {
  outboxEvent: { create: (args: unknown) => Promise<{ id: string }> };
};

type PrismaLike = TxOutbox & {
  outboxEvent: {
    create: (args: unknown) => Promise<{ id: string }>;
    findMany: (args: unknown) => Promise<Array<{
      id: string; aggregateType: string; aggregateId: string;
      eventType: string; payload: unknown; isProcessed: boolean; createdAt: Date;
    }>>;
    update: (args: unknown) => Promise<unknown>;
  };
  order: { update: (args: unknown) => Promise<unknown> };
};

export interface RetryJobInput {
  orderId: string;
  slipImageUrl: string;
  actorUserId: string;
  tenantId?: string;
}

@Injectable()
export class OrderAtomicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  /**
   * Validates a PAYMENT_VERIFIED completion payload against the spec §3.1
   * contract and writes the outbox row. Best-effort false on drift (the
   * payment itself must never fail because of analytics bookkeeping).
   */
  async recordGrantCompleted(
    tx: unknown,
    payload: Record<string, unknown>,
  ): Promise<{ recorded: boolean; id: string | null }> {
    const checked = SlipAtomicResponseSchema.safeParse(payload);
    if (!checked.success) {
      await this.emit('stream:monitor:contract-drift', { flow: 'outbox-grant', issues: checked.error.issues.length });
      return { recorded: false, id: null };
    }
    const db = tx as unknown as TxOutbox;
    const row = await db.outboxEvent.create({
      data: {
        aggregateType: 'ORDER',
        aggregateId: String(payload.orderId),
        orderId: String(payload.orderId),
        eventType: 'PAYMENT_VERIFIED_ENTITLEMENT_GRANTED',
        payload: checked.data,
      },
    }).catch(() => null);
    return row ? { recorded: true, id: row.id } : { recorded: false, id: null };
  }

  /** Enqueues a verify retry (spec §10). Idempotent per order while pending. */
  async enqueueSlipRetry(job: RetryJobInput): Promise<{ queued: boolean }> {
    const parsed = SlipRetryJobSchema.safeParse({
      ...job,
      attempts: 0,
      maxAttempts: 3,
      nextRunAt: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
    });
    if (!parsed.success) return { queued: false };
    const db = this.prisma as unknown as PrismaLike;
    const existing = await db.outboxEvent.findMany({
      where: { eventType: 'SLIP_VERIFY_RETRY', isProcessed: false },
      select: { id: true, payload: true },
    }).catch(() => []);
    const dup = existing.some((r) => (r.payload as { orderId?: string } | null)?.orderId === job.orderId);
    if (dup) return { queued: false };
    await db.outboxEvent.create({
      data: {
        aggregateType: 'ORDER',
        aggregateId: job.orderId,
        orderId: job.orderId,
        eventType: 'SLIP_VERIFY_RETRY',
        payload: parsed.data,
      },
    }).catch(() => null);
    await this.emit('stream:payment:slip-retry-enqueued', { orderId: job.orderId });
    return { queued: true };
  }

  /**
   * Dispatches up to `limit` unprocessed rows oldest-first to their
   * namespaced stream, then marks them processed. Returns dispatched ids.
   */
  async dispatchPending(limit = 50): Promise<{ dispatched: string[] }> {
    const db = this.prisma as unknown as PrismaLike;
    const rows = await db.outboxEvent.findMany({
      where: { isProcessed: false },
      orderBy: { createdAt: 'asc' },
      take: Math.max(1, Math.min(200, limit)),
    }).catch(() => []);
    const dispatched: string[] = [];
    for (const row of rows) {
      if (row.eventType === 'SLIP_VERIFY_RETRY') continue; // drained by drainSlipRetries
      await this.emit(`stream:outbox:${row.eventType}`, {
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        payload: row.payload,
      });
      await db.outboxEvent.update({
        where: { id: row.id },
        data: { isProcessed: true, processedAt: new Date() },
      }).catch(() => null);
      dispatched.push(row.id);
    }
    return { dispatched };
  }

  /**
   * Re-drives due retry jobs via `verify`. Exhausted jobs flip the order to
   * FAILED and are marked processed; successful verifications are marked
   * processed (their own outbox row carries the completion).
   */
  async drainSlipRetries(
    limit: number,
    verify: (job: { orderId: string; slipImageUrl: string; actorUserId: string }) => Promise<{ success: boolean }>,
  ): Promise<{ processed: number; succeeded: number; exhausted: number }> {
    const db = this.prisma as unknown as PrismaLike;
    const rows = await db.outboxEvent.findMany({
      where: { eventType: 'SLIP_VERIFY_RETRY', isProcessed: false },
      orderBy: { createdAt: 'asc' },
      take: Math.max(1, Math.min(100, limit)),
    }).catch(() => []);
    let processed = 0;
    let succeeded = 0;
    let exhausted = 0;
    for (const row of rows) {
      const job = SlipRetryJobSchema.safeParse(row.payload);
      if (!job.success) {
        await this.markProcessed(row.id);
        processed++;
        continue;
      }
      if (new Date(job.data.nextRunAt).getTime() > Date.now()) continue;
      processed++;
      try {
        const res = await verify({
          orderId: job.data.orderId,
          slipImageUrl: job.data.slipImageUrl,
          actorUserId: job.data.actorUserId,
        });
        if (res.success) {
          succeeded++;
          await this.markProcessed(row.id);
        } else if (job.data.attempts + 1 >= job.data.maxAttempts) {
          exhausted++;
          await db.order.update({
            where: { id: job.data.orderId },
            data: { paymentStatus: 'FAILED' },
          }).catch(() => null);
          await this.markProcessed(row.id);
        } else {
          await db.outboxEvent.update({
            where: { id: row.id },
            data: { payload: { ...job.data, attempts: job.data.attempts + 1, nextRunAt: new Date(Date.now() + RETRY_DELAY_MS).toISOString() } },
          }).catch(() => null);
        }
      } catch {
        await db.outboxEvent.update({
          where: { id: row.id },
          data: { payload: { ...job.data, attempts: job.data.attempts + 1, nextRunAt: new Date(Date.now() + RETRY_DELAY_MS).toISOString() } },
        }).catch(() => null);
      }
    }
    return { processed, succeeded, exhausted };
  }

  /** Starts an in-process dispatcher; returns a stopper (same pattern as expiry sweeper). */
  startOutboxWorker(intervalMs = 15_000, limit = 50): () => void {
    const timer = setInterval(() => {
      void this.dispatchPending(limit).catch(() => undefined);
    }, Math.max(5_000, intervalMs));
    if (typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
  }

  private async markProcessed(id: string): Promise<void> {
    const db = this.prisma as unknown as PrismaLike;
    await db.outboxEvent.update({
      where: { id },
      data: { isProcessed: true, processedAt: new Date() },
    }).catch(() => null);
  }

  private async emit(stream: string, payload: Record<string, unknown>): Promise<void> {
    await this.redis.publish(stream, JSON.stringify({ ...payload, at: new Date().toISOString() })).catch(() => undefined);
  }
}

export type { OutboxEventType };
