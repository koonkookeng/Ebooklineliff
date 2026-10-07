// SSOT Phase 038 Task 4 — Book job entity (pipeline state-machine invariants)
// Canonical: apps/backend/src/modules/pipeline/domain/entities/book-job.entity.ts
// (legacy src/backend/modules/pipeline/domain/entities/book-job.entity.ts)
// - Legal transitions only (QUEUED→…→COMPLETED, any→FAILED); progress clamped
//   0–100 and monotonic within a job lifetime (replays never rewind).
// - Zero new deps.
import { BookJobStatusEnum, type BookJobStatus } from '@repo/shared';

const NEXT: Record<BookJobStatus, BookJobStatus[]> = {
  QUEUED: ['PARSING_STRUCTURE', 'FAILED'],
  PARSING_STRUCTURE: ['GENERATING_VECTOR_CHUNKS', 'FAILED'],
  GENERATING_VECTOR_CHUNKS: ['ENCRYPTING_ASSETS', 'FAILED'],
  ENCRYPTING_ASSETS: ['UPLOADING_R2', 'FAILED'],
  UPLOADING_R2: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['QUEUED'],
};

export interface BookJobProps {
  productId: string;
  status: BookJobStatus;
  progressPercentage: number;
  totalPages: number;
  processedPages: number;
}

export class BookJob {
  private constructor(readonly props: BookJobProps) {}

  static create(productId: string): BookJob {
    if (!productId) throw new Error('Missing product id');
    return new BookJob({ productId, status: 'QUEUED', progressPercentage: 0, totalPages: 0, processedPages: 0 });
  }

  static rehydrate(props: BookJobProps): BookJob {
    if (!BookJobStatusEnum.options.includes(props.status)) throw new Error('Unknown job status');
    return new BookJob(props);
  }

  transitionTo(next: BookJobStatus, progress: number, processed: number, total: number): void {
    if (!NEXT[this.props.status].includes(next)) throw new Error(`Illegal job transition ${this.props.status} → ${next}`);
    if (progress < 0 || progress > 100) throw new Error('Progress out of range');
    if (progress < this.props.progressPercentage && next !== 'QUEUED') throw new Error('Progress must not rewind');
    this.props.status = next;
    this.props.progressPercentage = progress;
    this.props.processedPages = processed;
    this.props.totalPages = total;
  }
}
