// SSOT Phase 024 Task 8 — Admin notifications console API (stats + recent logs)
// Canonical: apps/backend/src/modules/line-service-message/webhooks/admin-notifications.controller.ts
// - Query-validated, tenant-scoped reads only (no PII beyond lineUserId hash-free ids;
//   payload bodies are never returned here).
import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { LineServiceMessageService } from '../application/line-service-message.service';

const TenantQuerySchema = z.object({ tenantId: z.string().min(1) });

@Controller('api/v1/admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly dispatch: LineServiceMessageService) {}

  @Get('stats')
  stats(@Query() query: unknown): Promise<Record<string, number>> {
    const parsed = TenantQuerySchema.safeParse(query);
    if (!parsed.success) return Promise.resolve({ QUEUED: 0, PROCESSING: 0, DELIVERED: 0, FAILED: 0, FALLBACK_SENT: 0 });
    return this.dispatch.getDispatchStats(parsed.data.tenantId);
  }

  @Get('logs')
  logs(@Query() query: unknown): Promise<
    Array<{ id: string; messageType: string; status: string; retryCount: number; createdAt: Date }>
  > {
    const parsed = TenantQuerySchema.safeParse(query);
    if (!parsed.success) return Promise.resolve([]);
    return this.dispatch.recentLogs(parsed.data.tenantId);
  }
}
