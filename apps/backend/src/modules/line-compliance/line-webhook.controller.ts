// SSOT Phase 129 §5/§8.1 — strict LINE event webhook listener
// Canonical: apps/backend/src/modules/line-compliance/line-webhook.controller.ts
// (legacy src/backend/modules/line-compliance/line-webhook.controller.ts)
// - POST /api/v1/line-compliance/webhook rides LineSignatureGuard (HMAC
//   first, BDD-1); accepted events are audit-logged (immutable lane) and
//   acked. No business logic here — fan-out stays in the 034 OA lane.
// - Zero new deps.
import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { LineSignatureGuard } from '../security/guards/line-signature.guard';
import { AuditLoggerService } from '../security/services/audit-logger.service';

type WebhookReq = {
  headers?: Record<string, string | undefined>;
  ip?: string;
};

interface LineEvent {
  type?: unknown;
  replyToken?: unknown;
  source?: { userId?: unknown };
}

@Controller('api/v1/line-compliance')
export class LineWebhookController {
  constructor(private readonly audit: AuditLoggerService) {}

  @Post('webhook')
  @UseGuards(LineSignatureGuard)
  @HttpCode(200)
  async intake(@Req() req: WebhookReq, @Body() body: unknown): Promise<{ ok: boolean; received: number }> {
    const events = (body as { events?: LineEvent[] } | null)?.events ?? [];
    const ip = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    try {
      await this.audit.logImmutable({
        action: 'LINE_WEBHOOK_RECEIVED',
        resource: `line-webhook:${events.length}`,
        ipAddress: ip,
        userAgent: req.headers?.['user-agent'] ?? 'line-platform',
        newData: { eventTypes: events.map((e) => String(e.type ?? 'unknown')).slice(0, 20) },
      });
    } catch {
      /* audit lane never breaks webhook ack */
    }
    return { ok: true, received: events.length };
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const LineWebhookControllerController = LineWebhookController;
