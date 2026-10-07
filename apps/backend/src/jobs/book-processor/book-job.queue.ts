// SSOT Phase 038 Task 6/§10 — Book job queue (FIFO + 3x retry + DLQ seam)
// Canonical: apps/backend/src/jobs/book-processor/book-job.queue.ts
// (legacy src/backend/jobs/book-processor/book-job.queue.ts)
// - RISK_CALL deviation (documented): no BullMQ in this monorepo (Gate 5) —
//   an in-process FIFO with attempt counting, exponential backoff
//   (500ms × 2^n), max 3 retries, then DLQ hand-off. The processor delegate
//   keeps the BullMQ seam: swapping enqueue() for a BullMQ add() later needs
//   no caller changes.
// - Framework-free (unit-tested without Nest); a thin starter wires it in
//   the pipeline module. Zero new deps.
import { PIPELINE_MAX_RETRIES } from '@repo/shared';

export interface BookJob {
  jobId: string;
  productId: string;
  run: () => Promise<void>;
  attempts: number;
}

export interface DeadLetter {
  jobId: string;
  productId: string;
  error: string;
  attempts: number;
}

const BASE_BACKOFF_MS = 500;

export function backoffMs(attempt: number): number {
  return BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
}

export class BookJobQueue {
  private readonly fifo: BookJob[] = [];
  private readonly dlq: DeadLetter[] = [];
  private draining = false;

  constructor(private readonly maxRetries: number = PIPELINE_MAX_RETRIES) {}

  get depth(): number {
    return this.fifo.length;
  }

  get deadLetters(): DeadLetter[] {
    return [...this.dlq];
  }

  enqueue(job: Omit<BookJob, 'attempts'>): void {
    this.fifo.push({ ...job, attempts: 0 });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.fifo.length > 0) {
        const job = this.fifo.shift() as BookJob;
        try {
          await job.run();
        } catch (err) {
          const attempts = job.attempts + 1;
          if (attempts >= this.maxRetries) {
            this.dlq.push({ jobId: job.jobId, productId: job.productId, error: err instanceof Error ? err.message : 'unknown', attempts });
            continue;
          }
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempts)));
          this.fifo.push({ ...job, attempts });
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
