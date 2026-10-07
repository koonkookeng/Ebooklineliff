// SSOT Phase 044 §5.1 — VideoTranscodeProcessor044 (lesson drain step)
// Canonical: apps/backend/src/modules/stream/workers/video-transcode.processor.ts
// (legacy src/backend/modules/stream/workers/video-transcode.processor.ts)
// - Single-job runner bound to the FIFO queue: loads the ledger row, derives
//   the key URI + public base, and delegates execution to
//   FFmpegTranscoderService (which owns progress/variants/READY).
//   Failures propagate for queue retry (3x → DLQ, §10).
// - tsx-safe (no param decorators). Zero new deps.
import { Injectable } from '@nestjs/common';
import { FFmpegTranscoderService } from '../ffmpeg.service';

export interface LessonJobRow {
  id: string;
  lessonId: string;
  originalFileR2Path: string;
}

export interface LessonJobStore {
  findJob(jobId: string): Promise<LessonJobRow | null>;
}

@Injectable()
export class VideoTranscodeProcessor044 {
  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(
    private readonly store?: LessonJobStore,
    private readonly ffmpeg?: FFmpegTranscoderService,
    private readonly keyUriFor: (jobId: string) => string = (jobId) => `/api/v1/stream/key?jobId=${jobId}`,
    private readonly publicBaseUrl: string = process.env.R2_PUBLIC_BASE_URL ?? '',
  ) {}

  async processLessonTranscode(jobId: string): Promise<{ masterPlaylistUrl: string; variants: number }> {
    if (!this.store || !this.ffmpeg) throw new Error('Transcode processor unavailable');
    const row = await this.store.findJob(jobId).catch(() => null);
    if (!row) throw new Error('Transcode job not found');
    return this.ffmpeg.runLessonJob({
      jobId: row.id,
      lessonId: row.lessonId,
      inputR2Key: row.originalFileR2Path,
      keyUri: this.keyUriFor(row.id),
      publicBaseUrl: this.publicBaseUrl,
    });
  }
}
