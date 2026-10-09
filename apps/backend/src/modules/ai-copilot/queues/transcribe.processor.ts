// SSOT Phase 094 Task 3 — Transcribe processor (queue drain → STT → format)
// Canonical: apps/backend/src/modules/ai-copilot/queues/transcribe.processor.ts
// - Drains the transcribe queue: progress bands (extract 0-30 / transcribe
//   30-80 / format 80-100) → STT adapter → subtitle formatter →
//   COMPLETED/FAILED. Temp audio is never persisted (Gate 6).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { COPILOT_STREAM } from '@repo/shared';
import { DeterministicSttAdapter } from '../adapters/openai-whisper.adapter';
import { SubtitleFormatterService } from '../services/subtitle-formatter.service';
import { InMemoryTranscribeQueue } from './transcribe.queue';

export interface TranscribeJobStore {
  markProcessing(jobId: string): Promise<void>;
  markProgress(jobId: string, progressPercent: number): Promise<void>;
  markCompleted(jobId: string): Promise<void>;
  markFailed(jobId: string, errorMessage: string): Promise<void>;
}

export interface TranscribeBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

@Injectable()
export class TranscribeProcessor {
  constructor(
    private readonly queue: InMemoryTranscribeQueue,
    private readonly stt: DeterministicSttAdapter,
    private readonly formatter: SubtitleFormatterService,
    private readonly jobs: TranscribeJobStore,
    private readonly bus?: TranscribeBus,
  ) {}

  async drain(limit = 10): Promise<{ processed: number }> {
    let processed = 0;
    for (let i = 0; i < limit; i++) {
      const job = this.queue.take();
      if (!job) break;
      try {
        await this.jobs.markProcessing(job.jobId);
        await this.jobs.markProgress(job.jobId, 20);
        const cues = await this.stt.transcribe({
          transcriptText: job.transcriptText,
          durationSec: job.durationSec,
          language: job.language,
        });
        if (cues.length === 0) throw new Error('Empty transcript — cannot transcribe');
        await this.jobs.markProgress(job.jobId, 70);
        await this.formatter.formatAndStore({
          lessonId: job.lessonId,
          language: job.language,
          cues: cues.map((c) => ({ startTimeSec: c.startTimeSec, endTimeSec: c.endTimeSec, text: c.text })),
        });
        await this.jobs.markProgress(job.jobId, 100);
        await this.jobs.markCompleted(job.jobId);
        await this.bus
          ?.xadd(COPILOT_STREAM, { event: 'transcribe_completed', jobId: job.jobId, cues: cues.length, at: Date.now() })
          .catch(() => undefined);
        processed++;
      } catch (e) {
        await this.jobs.markFailed(job.jobId, (e as Error).message).catch(() => undefined);
      }
    }
    return { processed };
  }
}
