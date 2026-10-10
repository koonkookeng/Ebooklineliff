// SSOT Phase 112 Task 6 §7.1 — moderation scan-event webhook (upload pipeline)
// Canonical: apps/backend/src/api/webhooks/moderation/moderation-event.controller.ts
// (legacy src/backend/api/webhooks/moderation/**)
// - HMAC-SHA256 guarded (x-moderation-signature over raw JSON body,
//   timing-safe; MODERATION_WEBHOOK_SECRET env-first). Fail-closed 401,
//   idempotent enqueue per productId (FIFO dedupe by trailing duplicate),
//   triggers async worker drain (BDD-1 <1.5s measured per item).
// - Never deletes source bytes. Zero new deps.
import { BadRequestException, Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ModerationQueueProcessor } from '../../../modules/moderation/queues/moderation.processor';
import { ModerationContentTypeEnum } from '@repo/shared';

function verifyModerationSignature(rawBody: string, signature: string | undefined): void {
  const secret = process.env['MODERATION_WEBHOOK_SECRET'] ?? '';
  if (!signature || !secret) throw new UnauthorizedException('Missing moderation webhook signature');
  const computed = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (signature.length !== computed.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(computed))) {
    throw new UnauthorizedException('Invalid moderation webhook signature');
  }
}

@Controller('api/webhooks/moderation')
export class ModerationEventController {
  constructor(private readonly queue: ModerationQueueProcessor) {}

  @Post('scan-event')
  async scanEvent(@Body() body: unknown, @Headers('x-moderation-signature') signature: string | undefined) {
    verifyModerationSignature(JSON.stringify(body), signature);
    const b = (body ?? {}) as { productId?: string; contentType?: string; tenantName?: string };
    if (!b.productId) throw new BadRequestException('Missing productId');
    const parsed = ModerationContentTypeEnum.safeParse(b.contentType ?? 'EBOOK');
    if (!parsed.success) throw new BadRequestException('Invalid contentType');
    const pending = this.queue.enqueue({ productId: b.productId, contentType: parsed.data, tenantName: b.tenantName ?? 'default' });
    const stats = await this.queue.drain(1);
    return { queued: true, pending, drained: stats.drained, quarantined: stats.quarantined };
  }
}
