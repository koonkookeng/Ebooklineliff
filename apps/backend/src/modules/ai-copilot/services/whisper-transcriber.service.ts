// SSOT Phase 094 Task 3 — Whisper transcriber service (job intake + enqueue)
// Canonical: apps/backend/src/modules/ai-copilot/services/whisper-transcriber.service.ts
// - Creates the VIDEO_TRANSCRIBE job row and enqueues chunk work (<30s
//   intake; heavy lifting rides the processor). Port-based tests.
import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CaptionLanguageEnum, COPILOT_STREAM } from '@repo/shared';
import { InMemoryTranscribeQueue } from '../queues/transcribe.queue';

const IntakeSchema = z.object({
  lessonId: z.string().uuid(),
  transcriptText: z.string().min(1),
  durationSec: z.number().positive(),
  language: CaptionLanguageEnum.default('TH'),
});

export interface TranscribeJobStore {
  createJob(args: { userId: string; jobType: string; inputPayload: unknown }): Promise<{ id: string }>;
}

export interface TranscribeBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

@Injectable()
export class WhisperTranscriberService {
  constructor(
    private readonly queue: InMemoryTranscribeQueue,
    private readonly jobs: TranscribeJobStore,
    private readonly bus?: TranscribeBus,
  ) {}

  async requestTranscribe(args: {
    userId: string;
    lessonId: string;
    transcriptText: string;
    durationSec: number;
    language?: string;
  }): Promise<{ jobId: string; queued: number }> {
    const parsed = IntakeSchema.safeParse({ ...args, language: args.language ?? 'TH' });
    if (!parsed.success) throw new BadRequestException('Invalid transcribe request');
    const job = await this.jobs.createJob({ userId: args.userId, jobType: 'VIDEO_TRANSCRIBE', inputPayload: parsed.data });
    await this.queue.enqueue({
      jobId: job.id,
      lessonId: parsed.data.lessonId,
      transcriptText: parsed.data.transcriptText,
      durationSec: parsed.data.durationSec,
      language: parsed.data.language,
    });
    await this.bus
      ?.xadd(COPILOT_STREAM, { event: 'transcribe_queued', jobId: job.id, at: Date.now() })
      .catch(() => undefined);
    return { jobId: job.id, queued: this.queue.size() };
  }
}
