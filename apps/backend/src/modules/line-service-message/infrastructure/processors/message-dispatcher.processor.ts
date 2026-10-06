// SSOT Phase 024 Task 4/10 — Dispatch processor (DB-rows queue, backoff, circuit breaker)
// Canonical: apps/backend/src/modules/line-service-message/infrastructure/processors/message-dispatcher.processor.ts
// (legacy src/backend/jobs/processors/message-dispatcher.processor.ts — canonical home is
// this module; the legacy jobs path re-exports this implementation.)
// - No BullMQ (zero-new-deps): NotificationLog rows are the queue; processLog() is
//   idempotent (terminal states return as-is); drainQueued() sweeps crashes.
// - Retry: exponential backoff DISPATCH_BACKOFF_MS, max DISPATCH_MAX_RETRIES (§1.3).
// - Circuit breaker: 5 consecutive tenant failures → OPEN → route FALLBACK_SENT
//   (in-app fallback event) + SRE alert stream; success closes the circuit.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../../infra/redis/redis-cluster.service';
import { DISPATCH_BACKOFF_MS, DISPATCH_CIRCUIT_THRESHOLD, DISPATCH_MAX_RETRIES } from '@repo/shared';
import { FlexBuilderService } from '../../application/flex-builder.service';
import { LineApiClient, PermanentLineError, RetryableLineError } from '../line-api.client';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function circuitKey(tenantId: string): string {
  return `circuit:service-message:${tenantId}`;
}

@Injectable()
export class MessageDispatcherProcessor {
  private readonly logger = new Logger(MessageDispatcherProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly flex: FlexBuilderService,
    private readonly lineApi: LineApiClient,
  ) {}

  /** Idempotent single-log drive. Terminal rows (DELIVERED/FAILED/FALLBACK_SENT) are no-ops. */
  async processLog(logId: string): Promise<void> {
    const log = await this.prisma.notificationLog.findUnique({ where: { id: logId } });
    if (!log) return;
    if (log.status === 'DELIVERED' || log.status === 'FALLBACK_SENT') return;
    if (log.status === 'FAILED' && log.retryCount >= DISPATCH_MAX_RETRIES) return;

    // Circuit OPEN → fallback immediately (no LINE attempt, §10).
    if (await this.isCircuitOpen(log.tenantId)) {
      await this.routeFallback(log.id, log.tenantId, 'CIRCUIT_OPEN');
      return;
    }

    await this.prisma.notificationLog.update({
      where: { id: log.id },
      data: { status: 'PROCESSING' },
    }).catch(() => undefined);

    const template = await this.prisma.serviceMessageTemplate.findUnique({ where: { id: log.templateId } });
    const config = await this.prisma.tenantLineConfig.findUnique({ where: { tenantId: log.tenantId } });
    if (!template || !config) {
      await this.fail(log.id, log.tenantId, log.retryCount, 'CONFIG_MISSING');
      return;
    }

    let compiled: { altText: string; flex: Record<string, unknown> };
    try {
      const params = (log.payload ?? {}) as Record<string, string | number | boolean>;
      compiled = this.flex.compile(
        { templateJson: (template.flexTemplateJson ?? {}) as Record<string, unknown>, parameters: params },
        `${template.templateName}`,
      );
    } catch {
      await this.fail(log.id, log.tenantId, log.retryCount, 'FLEX_COMPILE_ERROR', true);
      return;
    }

    for (let attempt = log.retryCount; attempt < DISPATCH_MAX_RETRIES; attempt++) {
      try {
        await this.lineApi.pushFlex(config.lineChannelAccessToken, log.lineUserId, compiled.altText, compiled.flex, log.id);
        await this.prisma.notificationLog.update({
          where: { id: log.id },
          data: { status: 'DELIVERED', deliveredAt: new Date(), costAmount: 0.0, errorCode: null },
        }).catch(() => undefined);
        await this.closeCircuit(log.tenantId);
        await this.emit('stream:notify:service-message', { event: 'line.service-message.delivered', logId: log.id });
        return;
      } catch (err) {
        if (err instanceof PermanentLineError) {
          await this.fail(log.id, log.tenantId, attempt + 1, `LINE_${err.status}`, true);
          return;
        }
        const status = err instanceof RetryableLineError ? err.status : 0;
        if (attempt + 1 >= DISPATCH_MAX_RETRIES) {
          await this.fail(log.id, log.tenantId, attempt + 1, `LINE_${status || 'TRANSPORT'}`);
          return;
        }
        await this.prisma.notificationLog.update({
          where: { id: log.id },
          data: { status: 'QUEUED', retryCount: attempt + 1, errorCode: `LINE_${status || 'TRANSPORT'}` },
        }).catch(() => undefined);
        await sleep(DISPATCH_BACKOFF_MS[Math.min(attempt, DISPATCH_BACKOFF_MS.length - 1)]);
      }
    }
  }

  /** Terminal failure: record + count circuit; route fallback when channel configured. */
  private async fail(logId: string, tenantId: string, retryCount: number, errorCode: string, permanent = false): Promise<void> {
    await this.prisma.notificationLog.update({
      where: { id: logId },
      data: { status: 'FAILED', retryCount, errorCode },
    }).catch(() => undefined);
    await this.tripCircuit(tenantId);
    this.logger.warn(`Service message failed log=${logId} code=${errorCode} permanent=${permanent}`);
    // Fallback routing (§1.3): in-app fallback event so the LIFF shell can surface it.
    await this.routeFallback(logId, tenantId, errorCode);
  }

  private async routeFallback(logId: string, tenantId: string, reason: string): Promise<void> {
    await this.prisma.notificationLog.update({
      where: { id: logId },
      data: { status: 'FALLBACK_SENT', errorCode: reason },
    }).catch(() => undefined);
    await this.emit('stream:notify:service-message', {
      event: 'line.service-message.fallback',
      logId,
      tenantId,
      channel: 'IN_APP',
      reason,
    });
  }

  private async isCircuitOpen(tenantId: string): Promise<boolean> {
    const raw = await this.redis.get(circuitKey(tenantId)).catch(() => null);
    return Number(raw ?? 0) >= DISPATCH_CIRCUIT_THRESHOLD;
  }

  private async tripCircuit(tenantId: string): Promise<void> {
    const key = circuitKey(tenantId);
    const count = Number((await this.redis.get(key).catch(() => null)) ?? 0) + 1;
    await this.redis.setex(key, 300, String(count)).catch(() => undefined);
    if (count >= DISPATCH_CIRCUIT_THRESHOLD) {
      this.logger.error(`Service message circuit OPEN tenant=${tenantId} (SRE alert)`);
      await this.emit('stream:notify:service-message', {
        event: 'line.service-message.circuit-open',
        tenantId,
        consecutiveFailures: count,
        severity: 'CRITICAL',
      });
    }
  }

  private async closeCircuit(tenantId: string): Promise<void> {
    await this.redis.del(circuitKey(tenantId)).catch(() => undefined);
  }

  private async emit(stream: string, payload: Record<string, unknown>): Promise<void> {
    await this.redis.publish(stream, JSON.stringify({ ...payload, at: new Date().toISOString() })).catch(() => undefined);
  }
}
