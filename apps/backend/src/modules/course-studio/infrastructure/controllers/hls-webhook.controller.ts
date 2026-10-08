// SSOT Phase 078 BDD-2 — HLS transcode webhook (public HMAC endpoint)
// Canonical: apps/backend/src/modules/course-studio/infrastructure/controllers/hls-webhook.controller.ts
// - POST /api/v1/studio/hls-webhook (registered via CourseStudioModule).
//   Public route: trust comes from the shared HMAC secret, not JWT.
// - Zero new deps.
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ProcessHlsWebhookUseCase } from '../../application/use-cases/process-hls-webhook.use-case';

@Controller('api/v1/studio')
export class HlsWebhookController {
  constructor(private readonly webhook: ProcessHlsWebhookUseCase) {}

  @Post('hls-webhook')
  @HttpCode(HttpStatus.OK)
  handleTranscodeWebhook(@Body() rawBody: unknown) {
    return this.webhook.execute(rawBody);
  }
}
