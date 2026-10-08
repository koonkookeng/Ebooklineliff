// SSOT Phase 078 §5.1 — Process HLS webhook use-case (intent entry)
// Canonical: apps/backend/src/modules/course-studio/application/use-cases/process-hls-webhook.use-case.ts
// - Intent entry point for the transcode webhook; orchestration lives in
//   HlsTranscoderService (single SSOT, Zero Redundant).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { HlsTranscoderService } from '../services/hls-transcoder.service';

@Injectable()
export class ProcessHlsWebhookUseCase {
  constructor(private readonly transcoder: HlsTranscoderService) {}

  execute(rawBody: unknown): Promise<{ ok: boolean }> {
    return this.transcoder.applyTranscodeWebhook(rawBody);
  }
}
