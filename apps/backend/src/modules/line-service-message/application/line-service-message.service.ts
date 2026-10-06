// SSOT Phase 024 §5.2 — Dispatcher engine (config → template → log row → drive)
// Canonical: apps/backend/src/modules/line-service-message/application/line-service-message.service.ts
// - Zero new deps: Prisma SSOT + RedisClusterService + FlexBuilderService + processor.
// - <50ms enqueue path (§11 Gate 5): two indexed reads + one insert, then the
//   processor drives delivery inline (best-effort) so tests/operators see status
//   without an external worker; sweeper re-drives QUEUED rows (crash-safe).
// - PII: fallbackPhone is SHA-256 hashed before persistence (PDPA/GDPR, §8.1);
//   channel tokens never logged.
// - Trigger seam for order/slip modules (READ_ONLY, Task 7): call
//   dispatchTransactionalMessage() — payment core stays untouched.
import { createHash } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  ServiceMessageDispatchPayloadSchema,
  type ServiceMessageDispatchPayload,
} from '@repo/shared';
import { FlexBuilderService } from './flex-builder.service';
import { MessageDispatcherProcessor } from '../infrastructure/processors/message-dispatcher.processor';

export function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex');
}

@Injectable()
export class LineServiceMessageService {
  private readonly logger = new Logger(LineServiceMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly flex: FlexBuilderService,
    private readonly processor: MessageDispatcherProcessor,
  ) {}

  /** Enqueue + drive a transactional service message. Returns the queue job (log) id. */
  async dispatchTransactionalMessage(raw: ServiceMessageDispatchPayload): Promise<{ jobId: string }> {
    const parsed = ServiceMessageDispatchPayloadSchema.safeParse(raw);
    if (!parsed.success) throw new NotFoundException('Invalid service message payload');
    const payload = parsed.data;

    const config = await this.prisma.tenantLineConfig.findUnique({ where: { tenantId: payload.tenantId } });
    if (!config || !config.isServiceMsgActive) {
      this.logger.warn(`Service Message disabled or not configured for Tenant: ${payload.tenantId}`);
      throw new NotFoundException('LINE Service Message channel inactive');
    }

    const template = await this.prisma.serviceMessageTemplate.findUnique({
      where: { tenantId_messageType: { tenantId: payload.tenantId, messageType: payload.messageType } },
    });
    if (!template || !template.isActive) {
      throw new NotFoundException(`Template not found for Message Type: ${payload.messageType}`);
    }
    if (payload.templateId && payload.templateId !== template.id) {
      throw new NotFoundException('Template id mismatch for tenant/message type');
    }

    const log = await this.prisma.notificationLog.create({
      data: {
        tenantId: payload.tenantId,
        userId: payload.userId,
        lineUserId: payload.lineUserId,
        messageType: payload.messageType,
        templateId: template.id,
        status: 'QUEUED',
        payload: {
          ...payload.parameters,
          ...(payload.fallbackPhone ? { fallbackPhoneHash: hashPhone(payload.fallbackPhone) } : {}),
        },
        costAmount: 0.0, // Zero Broadcast Fee (§11 Gate 6)
      },
    });

    await this.emit('stream:notify:service-message', {
      event: 'line.service-message.queued',
      logId: log.id,
      tenantId: payload.tenantId,
      messageType: payload.messageType,
    });

    // Inline drive (best-effort, non-blocking for the caller SLA).
    void this.processor.processLog(log.id).catch(() => undefined);

    return { jobId: log.id };
  }

  /** Crash-safe sweeper: re-drive stuck QUEUED rows (cap 100/sweep). */
  async drainQueued(limit = 100): Promise<{ drained: number }> {
    const rows = await this.prisma.notificationLog.findMany({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      take: Math.max(1, Math.min(limit, 100)),
    });
    for (const row of rows) {
      await this.processor.processLog(row.id).catch(() => undefined);
    }
    return { drained: rows.length };
  }

  /** Admin stats (Task 8 dashboard source). */
  async getDispatchStats(tenantId: string): Promise<Record<string, number>> {
    const rows = await this.prisma.notificationLog.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { status: true },
    });
    const stats: Record<string, number> = { QUEUED: 0, PROCESSING: 0, DELIVERED: 0, FAILED: 0, FALLBACK_SENT: 0 };
    for (const row of rows) stats[row.status] = row._count.status;
    return stats;
  }

  async recentLogs(tenantId: string, limit = 20): Promise<
    Array<{ id: string; messageType: string; status: string; retryCount: number; createdAt: Date }>
  > {
    return this.prisma.notificationLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(limit, 50)),
      select: { id: true, messageType: true, status: true, retryCount: true, createdAt: true },
    });
  }

  private async emit(stream: string, payload: Record<string, unknown>): Promise<void> {
    await this.redis.publish(stream, JSON.stringify({ ...payload, at: new Date().toISOString() })).catch(() => undefined);
  }
}
