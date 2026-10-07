// SSOT Phase 043 §5.1/§10 — Video transcode queue (FIFO + retry + DLQ)
// Canonical: apps/backend/src/jobs/transcoder/video-transcode.queue.ts
// (legacy src/backend/jobs/transcoder/video-transcode.queue.ts)
// - Same no-BullMQ doctrine as Phase 038 BookJobQueue: in-process FIFO,
//   exponential backoff (500ms × 2^n), VIDEO_MAX_RETRIES then DLQ.
//   Swapping enqueue() for BullMQ add() later needs no caller changes.
// - Framework-free (unit-tested without Nest). Zero new deps.
import { VIDEO_MAX_RETRIES } from '@repo/shared';

export interface VideoTranscodeJob {
  jobId: string;
  videoId: string;
  run: () => Promise<void>;
  attempts: number;
}

export interface VideoDeadLetter {
  jobId: string;
  videoId: string;
  error: string;
  attempts: number;
}

const BASE_BACKOFF_MS = 500;

export function transcodeBackoffMs(attempt: number): number {
  return BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
}

export class VideoTranscodeQueue {
  private readonly fifo: VideoTranscodeJob[] = [];
  private readonly dlq: VideoDeadLetter[] = [];
  private draining = false;

  constructor(private readonly maxRetries: number = VIDEO_MAX_RETRIES) {}

  get depth(): number {
    return this.fifo.length;
  }

  get deadLetters(): VideoDeadLetter[] {
    return [...this.dlq];
  }

  enqueue(job: Omit<VideoTranscodeJob, 'attempts'>): void {
    this.fifo.push({ ...job, attempts: 0 });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.fifo.length > 0) {
        const job = this.fifo.shift() as VideoTranscodeJob;
        try {
          await job.run();
        } catch (err) {
          const attempts = job.attempts + 1;
          if (attempts >= this.maxRetries) {
            this.dlq.push({ jobId: job.jobId, videoId: job.videoId, error: err instanceof Error ? err.message : 'unknown', attempts });
            continue;
          }
          await new Promise((resolve) => setTimeout(resolve, transcodeBackoffMs(attempts)));
          this.fifo.push({ ...job, attempts });
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
