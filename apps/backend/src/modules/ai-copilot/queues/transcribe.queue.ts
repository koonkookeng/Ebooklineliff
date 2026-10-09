// SSOT Phase 094 Task 3 — Transcribe queue (in-memory FIFO, BullMQ-compatible seam)
// Canonical: apps/backend/src/modules/ai-copilot/queues/transcribe.queue.ts
// - RISK_CALL: in-memory FIFO (zero new deps). BullMQ can replace this file
//   without touching callers (same TranscribeQueuePort surface).
export interface TranscribeJob {
  jobId: string;
  lessonId: string;
  transcriptText: string;
  durationSec: number;
  language: string;
}

export interface TranscribeQueuePort {
  enqueue(job: TranscribeJob): Promise<void>;
  take(): TranscribeJob | null;
  size(): number;
}

export class InMemoryTranscribeQueue implements TranscribeQueuePort {
  private readonly fifo: TranscribeJob[] = [];

  async enqueue(job: TranscribeJob): Promise<void> {
    this.fifo.push(job);
  }

  take(): TranscribeJob | null {
    return this.fifo.shift() ?? null;
  }

  size(): number {
    return this.fifo.length;
  }
}
