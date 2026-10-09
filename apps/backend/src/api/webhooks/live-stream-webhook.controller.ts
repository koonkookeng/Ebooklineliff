// SSOT Phase 102 Task 3 — Provider stream webhook (STREAM_START/END/RECORDING_COMPLETE)
// Canonical: apps/backend/src/api/webhooks/live-stream-webhook.controller.ts
// - Public intake (provider-signed in prod via HMAC guard lane; Zod gate
//   here) → VOD orchestrator (099 archive step reused inside the worker).
//   Idempotent redelivery safe. Zero new deps.
import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { StreamWebhookEventSchema } from '@repo/shared';
import { LiveToVodService } from '../../modules/stream/application/live-to-vod.service';

@Controller('webhooks/stream')
export class LiveStreamWebhookController {
  constructor(private readonly pipeline: LiveToVodService) {}

  @Post('event')
  @HttpCode(200)
  async handleStreamEvent(@Body() rawBody: unknown) {
    const parsed = StreamWebhookEventSchema.safeParse(rawBody ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid stream event');
    return this.pipeline.ingest(parsed.data);
  }
}
