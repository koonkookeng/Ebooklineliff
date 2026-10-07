// SSOT Phase 034 Task 3/§5.2 — LINE OA webhook (follow/unfollow sync, <500ms)
// Canonical: apps/backend/src/webhooks/line-messaging.controller.ts
// (legacy src/backend/webhooks/line-messaging.controller.ts)
// - POST webhooks/line/oa: HMAC-SHA256 over the delivery bytes (guard-style:
//   raw string when available, else JSON re-serialization — same semantics as
//   the Phase 004 LineSignatureGuard), Zod envelope gate, then OA processing.
// - Never 400s a genuine LINE delivery (unknown event types are skipped inside
//   the service); 401 only on missing/invalid signature (Gate 4).
// - Distinct from api/webhooks line-messaging (Phase 004 messaging ACK path).
// - Zero new deps.
import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Req, UnauthorizedException } from '@nestjs/common';
import { LineOAService } from '../modules/line-oa/line-oa.service';
import { LineWebhookEventSchema } from '@repo/shared';

interface WebhookReq {
  rawBody?: unknown;
}

function deliveryBytes(body: unknown, rawBody: unknown): string {
  if (typeof rawBody === 'string' && rawBody) return rawBody;
  if (typeof rawBody !== 'undefined') {
    try {
      return JSON.stringify(rawBody) ?? '';
    } catch {
      return '';
    }
  }
  try {
    return JSON.stringify(body ?? {}) ?? '';
  } catch {
    return '';
  }
}

@Controller('webhooks/line')
export class LineMessagingWebhookController {
  constructor(private readonly lineOA: LineOAService) {}

  @Post('oa')
  @HttpCode(HttpStatus.OK)
  async handleOaWebhook(
    @Headers('x-line-signature') signature: string | undefined,
    @Body() body: unknown,
    @Req() req: WebhookReq,
  ) {
    if (!signature) throw new UnauthorizedException('Missing LINE signature header');
    const parsed = LineWebhookEventSchema.safeParse(body);
    if (!parsed.success) throw new UnauthorizedException('Invalid LINE webhook envelope');
    const bytes = deliveryBytes(body, req.rawBody);
    if (!this.lineOA.verifySignature(bytes, signature)) {
      throw new UnauthorizedException('Invalid LINE signature');
    }
    const { processed } = await this.lineOA.processWebhookEvents(
      parsed.data.events as Array<{ type?: unknown; source?: { userId?: unknown } }>,
    );
    return { status: 'success', processed };
  }
}
