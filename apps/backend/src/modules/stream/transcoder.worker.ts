// SSOT Phase 044 §5.1/§10 — TranscodeWorkerHost (ledger + FIFO owner)
// Canonical: apps/backend/src/modules/stream/transcoder.worker.ts
// (legacy src/backend/modules/stream/transcoder.worker.ts)
// - submitLessonJob: ledger upsert (QUEUED, idempotent per lesson) → FIFO
//   enqueue → {jobId}. The shared VideoTranscodeQueue (Phase 043, no BullMQ)
//   retries 3x with backoff, then DLQ; FAILED rows keep the error.
// - tsx-safe (no param decorators). Zero new deps.
import { Injectable } from '@nestjs/common';
import { VideoTranscodeQueue } from '../../jobs/transcoder/video-transcode.queue';
import type { SubmitTranscodeJob } from '@repo/shared';
import { VideoTranscodeProcessor044 } from './workers/video-transcode.processor';

export interface LessonLedgerTables {
  videoTranscodeJob: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
}

export interface LessonSubmit extends SubmitTranscodeJob {
  rawR2Key: string;
}

@Injectable()
export class TranscodeWorkerHost {
  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(
    private readonly tables?: LessonLedgerTables,
    private readonly queue?: VideoTranscodeQueue,
    private readonly processor?: VideoTranscodeProcessor044,
  ) {}

  async submitLessonJob(input: LessonSubmit): Promise<{ jobId: string; queued: boolean }> {
    if (!this.tables || !this.queue || !this.processor) throw new Error('Transcode worker unavailable');
    const row = await this.tables.videoTranscodeJob.upsert({
      where: { lessonId: input.lessonId },
      create: {
        lessonId: input.lessonId,
        originalFileName: input.originalFileName.slice(0, 255),
        originalFileR2Path: input.rawR2Key,
        fileSizeBytes: BigInt(Math.floor(input.fileSizeBytes)),
        durationSeconds: input.durationSeconds,
        status: 'QUEUED',
        progressPercentage: 0,
      },
      update: {
        originalFileName: input.originalFileName.slice(0, 255),
        originalFileR2Path: input.rawR2Key,
        fileSizeBytes: BigInt(Math.floor(input.fileSizeBytes)),
        durationSeconds: input.durationSeconds,
        status: 'QUEUED',
        progressPercentage: 0,
        errorMessage: null,
      },
    });
    const processor = this.processor;
    this.queue.enqueue({ jobId: row.id, videoId: input.lessonId, run: () => processor.processLessonTranscode(row.id).then(() => undefined) });
    return { jobId: row.id, queued: true };
  }
}
