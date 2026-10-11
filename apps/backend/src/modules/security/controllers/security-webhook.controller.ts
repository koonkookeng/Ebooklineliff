// SSOT Phase 120 §5.1 — security IP-event webhook (HMAC intake)
// Canonical: apps/backend/src/modules/security/controllers/security-webhook.controller.ts
// (legacy src/backend/modules/security/controllers/security-webhook.controller.ts)
// - POST ip-event (HMAC-SHA256 x-edge-signature, fail-closed 401) — Edge /
//   Cloudflare posts login IP events; delegates to IpAnomalyService verdict
//   (<500ms BDD-1). Mirrors the 115 bank-webhook intake pattern.
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { IpAnomalyService } from '../services/ip-anomaly.service';

function verifyEdgeSignature(rawBody: string, signature: string | undefined): void {
  const secret = process.env['EDGE_SECURITY_WEBHOOK_SECRET'] ?? '';
  if (!signature || !secret) throw new UnauthorizedException('Missing edge webhook signature');
  const computed = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (signature.length !== computed.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(computed))) {
    throw new UnauthorizedException('Invalid edge webhook signature');
  }
}

@Controller('api/webhooks/security')
export class SecurityWebhookController {
  constructor(private readonly anomalies: IpAnomalyService) {}

  @Get('health') health() { return { ok: true }; }

  @Post('ip-event')
  ipEvent(@Body() body: unknown, @Headers('x-edge-signature') signature: string | undefined) {
    verifyEdgeSignature(JSON.stringify(body), signature);
    const b = (body ?? {}) as { userId?: string; ipAddress?: string; userAgent?: string; deviceFingerprint?: string };
    if (!b.userId || !b.ipAddress || !b.userAgent || !b.deviceFingerprint) {
      throw new BadRequestException('Missing login event fields');
    }
    return this.anomalies.processLoginEvent({
      userId: b.userId,
      ipAddress: b.ipAddress,
      userAgent: b.userAgent,
      deviceFingerprint: b.deviceFingerprint,
    });
  }
}
