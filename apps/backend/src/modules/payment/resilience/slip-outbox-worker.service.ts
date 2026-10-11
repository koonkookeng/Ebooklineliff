// SSOT Phase 124 Task 4 §5.1 — slip outbox async worker (BDD-2 drain lane)
// Canonical: apps/backend/src/modules/payment/resilience/slip-outbox-worker.service.ts
// (legacy src/backend/modules/payment/resilience/slip-outbox-worker.service.ts)
// - enqueue(): idempotent PENDING row (P2002 → existing row, never a dup).
// - drain(): claims PENDING rows (single-worker claim key), verifies via
//   the EasySlip port, and hands success to the onVerified hook (the
//   012/015 atomic grant lane owns entitlements — this worker never writes
//   money tables directly). Failures back off jittered (1s/2s/4s/8s) and
//   flip FAILED past OUTBOX_MAX_RETRIES. Zero data loss: rows only leave
//   PENDING/PROCESSING via RESOLVED or FAILED.
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import {
  OUTBOX_EVENT_STREAM,
  OUTBOX_MAX_RETRIES,
  outboxBackoffMs,
  outboxClaimKey,
  type OutboxPaymentStatus,
} from '@repo/shared';

/**
 * Drain outcome vocabulary: the Prisma OutboxStatus lane resolves rows as
 * RESOLVED while the §3.1 Zod queue vocabulary completes them as
 * COMPLETED (spec dual-vocabulary; both mean drained-success).
 */
export type OutboxDrainStatus = OutboxPaymentStatus | 'RESOLVED';

export interface OutboxRow {
  orderId: string;
  slipImageUrl: string;
  retryCount: number;
  lastError: string | null;
  status: string;
}

export interface OutboxPrismaPort {
  paymentOutboxQueue: {
    upsert(args: unknown): Promise<OutboxRow>;
    findMany(args: unknown): Promise<OutboxRow[]>;
    update(args: unknown): Promise<OutboxRow>;
  };
}

export interface OutboxLockPort {
  setnx(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
  xaddPipeline?(streamKey: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

export interface OutboxVerifyPort {
  verify(slipUrl: string): Promise<{ transRef: string; amount: number; receiverAccount: string }>;
}

@Injectable()
export class SlipOutboxWorkerService {
  private readonly logger = new Logger(SlipOutboxWorkerService.name);

  constructor(
    private readonly prisma: OutboxPrismaPort,
    private readonly locks: OutboxLockPort,
    private readonly easyslip: OutboxVerifyPort,
    private readonly onVerified?: (row: OutboxRow, slip: { transRef: string; amount: number; receiverAccount: string }) => Promise<void>,
  ) {}

  /** Idempotent enqueue (duplicate orderId returns the existing row). */
  async enqueue(orderId: string, slipImageUrl: string): Promise<OutboxRow> {
    try {
      return await this.prisma.paymentOutboxQueue.upsert({
        where: { orderId },
        create: { orderId, slipImageUrl, status: 'PENDING' },
        update: {},
      });
    } catch (err) {
      if (/unique|P2002/i.test((err as Error).message)) {
        const rows = await this.prisma.paymentOutboxQueue.findMany({ where: { orderId } });
        if (rows[0]) return rows[0];
      }
      throw err;
    }
  }

  /**
   * Drain PENDING rows (self-healing lane; callers own the cadence).
   * Returns per-row outcomes; never throws on row faults.
   */
  async drain(limit = 25): Promise<Array<{ orderId: string; status: OutboxDrainStatus; attempts: number }>> {
    const out: Array<{ orderId: string; status: OutboxDrainStatus; attempts: number }> = [];
    let rows: OutboxRow[] = [];
    try {
      rows = await this.prisma.paymentOutboxQueue.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
    } catch (err) {
      this.logger.warn(`Outbox drain read fail-open: ${(err as Error).message}`);
      return out;
    }
    for (const row of rows) {
      const claimKey = outboxClaimKey(row.orderId);
      let claimed = false;
      try {
        claimed = await this.locks.setnx(claimKey, 'WORKER', 120);
      } catch {
        claimed = false;
      }
      if (!claimed) continue;
      try {
        await this.prisma.paymentOutboxQueue.update({
          where: { orderId: row.orderId },
          data: { status: 'PROCESSING' },
        });
        const slip = await this.easyslip.verify(row.slipImageUrl);
        await this.onVerified?.(row, slip);
        await this.prisma.paymentOutboxQueue.update({
          where: { orderId: row.orderId },
          data: { status: 'RESOLVED', lastError: null },
        });
        await this.locks.xaddPipeline?.(OUTBOX_EVENT_STREAM, [
          { event: 'outbox.resolved', orderId: row.orderId, transRef: slip.transRef, at: Date.now() },
        ]);
        out.push({ orderId: row.orderId, status: 'RESOLVED', attempts: row.retryCount + 1 });
      } catch (err) {
        const attempts = row.retryCount + 1;
        const terminal = attempts >= OUTBOX_MAX_RETRIES;
        try {
          await this.prisma.paymentOutboxQueue.update({
            where: { orderId: row.orderId },
            data: {
              status: terminal ? 'FAILED' : 'PENDING',
              retryCount: attempts,
              lastError: String((err as Error).message).slice(0, 2000),
            },
          });
        } catch {
          // Row state writes are best-effort; the claim TTL bounds rework.
        }
        if (!terminal) {
          const wait = outboxBackoffMs(row.retryCount);
          this.logger.warn(`Outbox retry ${row.orderId} in ~${wait}ms (attempt ${attempts})`);
        }
        out.push({ orderId: row.orderId, status: terminal ? 'FAILED' : 'PENDING', attempts });
      } finally {
        try {
          await this.locks.del(claimKey);
        } catch {
          // Claim TTL bounds orphan claims.
        }
      }
    }
    return out;
  }
}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { SlipOutboxWorkerService as SlipOutboxWorkerServiceService };
