// SSOT Phase 038 Task 6/§5.2 — Book pipeline processor (job lifecycle driver)
// Canonical: apps/backend/src/modules/pipeline/infrastructure/processors/book-pipeline.processor.ts
// (legacy src/backend/modules/pipeline/infrastructure/processors/book-pipeline.processor.ts)
// - Plain injectable (no @nestjs/bullmq dep — jobs arrive via BookJobQueue).
// - Lifecycle: QUEUED → PARSING_STRUCTURE → GENERATING_VECTOR_CHUNKS →
//   ENCRYPTING_ASSETS → UPLOADING_R2 → COMPLETED (progress via progressFor);
//   any throw → FAILED with message (entity guards the transition legality).
// - Job rows upsert by productId (Gate 7 — re-entrant, retry-safe).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../infra/database/prisma.service';
import { ProcessPdfToChunksUseCase } from '../../application/use-cases/process-pdf-to-chunks.use-case';
import { ProcessEpubToChunksUseCase } from '../../application/use-cases/process-epub-to-chunks.use-case';
import { BookJob } from '../../domain/entities/book-job.entity';
import { progressFor, type BookJobStatus, type PagePayload } from '@repo/shared';

interface ProcessorTables {
  bookProcessingJob: {
    upsert: (args: unknown) => Promise<unknown>;
  };
}

export interface PipelineRunInput {
  productId: string;
  bookId: string;
  watermarkSeed: string;
  fileType: 'PDF' | 'EPUB';
  pages: PagePayload[];
  spine?: Array<{ idref: string; xhtmlContent: string }>;
}

@Injectable()
export class BookPipelineProcessor {
  private readonly logger = new Logger(BookPipelineProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: ProcessPdfToChunksUseCase,
    private readonly epub: ProcessEpubToChunksUseCase,
  ) {}

  private async mark(productId: string, status: BookJobStatus, progress: number, total: number, processed: number, error?: string): Promise<void> {
    await (this.prisma as unknown as ProcessorTables).bookProcessingJob
      .upsert({
        where: { productId },
        update: {
          status,
          progressPercentage: progress,
          totalPages: total,
          processedPages: processed,
          ...(error !== undefined ? { errorMessage: error } : {}),
          ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
          ...(status === 'PARSING_STRUCTURE' ? { startedAt: new Date(), errorMessage: null } : {}),
        },
        create: { productId, status, progressPercentage: progress, totalPages: total, processedPages: processed },
      })
      .catch((err: unknown) => {
        this.logger.warn(`Job mark failed: ${err instanceof Error ? err.message : 'unknown'}`);
      });
  }

  /** Execute one book job end-to-end (queue delegate). Returns the job id. */
  async processJob(input: PipelineRunInput): Promise<{ jobId: string; totalPages: number }> {
    const jobId = randomUUID();
    const entity = BookJob.create(input.productId);
    this.logger.log(`Starting book pipeline ${jobId} for ${input.productId}`);
    try {
      entity.transitionTo('PARSING_STRUCTURE', 10, 0, 0);
      await this.mark(input.productId, 'PARSING_STRUCTURE', 10, 0, 0);
      entity.transitionTo('GENERATING_VECTOR_CHUNKS', 30, 0, input.pages.length || input.spine?.length || 0);
      await this.mark(input.productId, 'GENERATING_VECTOR_CHUNKS', 30, input.pages.length || 0, 0);
      entity.transitionTo('ENCRYPTING_ASSETS', 30, 0, input.pages.length || 0);

      const onProgress = async (processed: number, total: number) => {
        await this.mark(input.productId, 'UPLOADING_R2', progressFor(processed, total), total, processed);
      };
      const results =
        input.fileType === 'EPUB'
          ? await this.epub.execute(input.bookId, input.productId, input.watermarkSeed, input.spine ?? [], onProgress)
          : await this.pdf.execute(input.bookId, input.productId, input.watermarkSeed, input.pages, onProgress);

      entity.transitionTo('UPLOADING_R2', 95, results.length, results.length);
      entity.transitionTo('COMPLETED', 100, results.length, results.length);
      await this.mark(input.productId, 'COMPLETED', 100, results.length, results.length);
      this.logger.log(`Completed book pipeline ${jobId}: ${results.length} pages`);
      return { jobId, totalPages: results.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'pipeline failed';
      try {
        entity.transitionTo('FAILED', entity.props.progressPercentage, entity.props.processedPages, entity.props.totalPages);
      } catch {
        // Entity already terminal: record the failure regardless.
      }
      await this.mark(input.productId, 'FAILED', entity.props.progressPercentage, entity.props.totalPages, entity.props.processedPages, message);
      throw err;
    }
  }
}
