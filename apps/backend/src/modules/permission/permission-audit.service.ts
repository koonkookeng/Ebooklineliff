// SSOT Phase 032 Task 2 — Permission audit service (append-only funnel log)
// Canonical: apps/backend/src/modules/permission/permission-audit.service.ts
// (legacy src/backend/modules/permission/permission-audit.service.ts)
// - logAudit: Zod-gated append (Gate 7, never throws the UX path) + funnel
//   event publish (Gate 8, best-effort).
// - myLogs: indexed read for the user's own trail (no N+1, single query).
// - Zero new deps: Prisma SSOT + RedisClusterService (publish) only.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import {
  PERMISSION_ANALYTICS_CHANNEL,
  PermissionAuditLogSchema,
  type PermissionAuditLog,
} from '@repo/shared';

interface AuditTable {
  permissionAuditLog: {
    create: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<unknown[]>;
  };
}

@Injectable()
export class PermissionAuditService {
  private readonly logger = new Logger(PermissionAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private get table(): AuditTable {
    return this.prisma as unknown as AuditTable;
  }

  /** Append an audit row (400 on bad body; sinks never throw). */
  async logAudit(body: unknown): Promise<boolean> {
    const parsed = PermissionAuditLogSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid permission audit payload');
    const row: PermissionAuditLog = parsed.data;
    await this.table.permissionAuditLog
      .create({
        data: {
          userId: row.userId,
          permissionType: row.permissionType,
          status: row.status,
          purpose: row.purpose,
          devicePlatform: row.devicePlatform,
          ipAddress: row.ipAddress,
          userAgent: row.userAgent,
        },
      })
      .catch((err: unknown) => {
        this.logger.warn(`Audit write failed: ${err instanceof Error ? err.message : 'unknown'}`);
      });
    await this.redis
      .publish(
        PERMISSION_ANALYTICS_CHANNEL,
        JSON.stringify({
          event: row.status === 'GRANTED' ? 'permission_accepted' : row.status === 'DENIED' ? 'permission_denied' : 'permission_prompt_impression',
          userId: row.userId,
          permissionType: row.permissionType,
          devicePlatform: row.devicePlatform,
        }),
      )
      .catch((err: unknown) => {
        this.logger.warn(`Audit event failed: ${err instanceof Error ? err.message : 'unknown'}`);
      });
    return true;
  }

  async myLogs(userId: string): Promise<unknown[]> {
    if (!userId) throw new BadRequestException('Missing user id');
    return this.table.permissionAuditLog
      .findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 })
      .catch(() => []);
  }
}
