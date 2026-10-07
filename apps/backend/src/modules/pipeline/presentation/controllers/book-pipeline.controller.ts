// SSOT Phase 038 Task 6 — Book pipeline REST controller (creator entry)
// Canonical: apps/backend/src/modules/pipeline/presentation/controllers/book-pipeline.controller.ts
// (legacy src/backend/modules/pipeline/presentation/controllers/book-pipeline.controller.ts)
// - POST /api/v1/book-pipeline/start { productId, bookId, watermarkSeed,
//   fileType, pages?/spine? } — JWT-guarded; enqueues (202 semantics: returns
//   the queue depth, processing continues in background).
// - GET  /api/v1/book-pipeline/status?productId= — JWT; latest job snapshot.
// - POST /api/v1/book-pipeline/retry — JWT; re-enqueues the same payload.
// - Zero new deps.
import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../infra/database/prisma.service';
import { BookJobQueue } from '../../../../jobs/book-processor/book-job.queue';
import { BookPipelineProcessor, type PipelineRunInput } from '../../infrastructure/processors/book-pipeline.processor';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { PagePayloadSchema, type PagePayload } from '@repo/shared';

interface PipelineStatusTables {
  bookProcessingJob: {
    findUnique: (args: unknown) => Promise<{
      id: string;
      productId: string;
      status: string;
      progressPercentage: number;
      totalPages: number;
      processedPages: number;
      errorMessage: string | null;
    } | null>;
  };
}

function coercePages(body: Record<string, unknown>): { pages: PagePayload[]; spine: Array<{ idref: string; xhtmlContent: string }> } {
  const rawPages = Array.isArray(body['pages']) ? (body['pages'] as unknown[]) : [];
  const pages: PagePayload[] = [];
  for (const p of rawPages) {
    const parsed = PagePayloadSchema.safeParse(p);
    if (!parsed.success) throw new BadRequestException('Invalid page payload');
    pages.push(parsed.data);
  }
  const rawSpine = Array.isArray(body['spine']) ? (body['spine'] as unknown[]) : [];
  const spine = rawSpine.map((s, i) => {
    const row = s as { idref?: unknown; xhtmlContent?: unknown };
    if (typeof row.xhtmlContent !== 'string' || !row.xhtmlContent) throw new BadRequestException(`Invalid spine item ${i}`);
    return { idref: typeof row.idref === 'string' ? row.idref : `item-${i}`, xhtmlContent: row.xhtmlContent };
  });
  return { pages, spine };
}

@Controller('api/v1/book-pipeline')
export class BookPipelineController {
  private readonly queue = new BookJobQueue();

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: BookPipelineProcessor,
  ) {}

  @Post('start')
  @UseGuards(JwtAuthGuard)
  start(@Body() body: Record<string, unknown>) {
    const input = this.toRunInput(body);
    const jobId = randomUUID();
    this.queue.enqueue({ jobId, productId: input.productId, run: () => this.processor.processJob(input).then(() => undefined) });
    return { jobId, queued: true, queueDepth: this.queue.depth };
  }

  @Post('retry')
  @UseGuards(JwtAuthGuard)
  retry(@Body() body: Record<string, unknown>) {
    return this.start(body);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  async status(@Query('productId') productId: string | undefined) {
    if (!productId) throw new BadRequestException('Missing product id');
    const row = await (this.prisma as unknown as PipelineStatusTables).bookProcessingJob
      .findUnique({ where: { productId } })
      .catch(() => null);
    if (!row) {
      return { jobId: null, bookId: null, status: 'QUEUED', progressPercentage: 0, processedPages: 0, totalPages: 0, errorMessage: null };
    }
    return {
      jobId: row.id,
      bookId: productId,
      status: row.status,
      progressPercentage: row.progressPercentage,
      processedPages: row.processedPages,
      totalPages: row.totalPages,
      errorMessage: row.errorMessage,
    };
  }

  private toRunInput(body: Record<string, unknown>): PipelineRunInput {
    const productId = body['productId'];
    const bookId = body['bookId'];
    const watermarkSeed = body['watermarkSeed'];
    const fileType = body['fileType'];
    if (typeof productId !== 'string' || !productId) throw new BadRequestException('Missing product id');
    if (typeof bookId !== 'string' || !bookId) throw new BadRequestException('Missing book id');
    if (typeof watermarkSeed !== 'string' || !watermarkSeed) throw new BadRequestException('Missing watermark seed');
    if (fileType !== 'PDF' && fileType !== 'EPUB') throw new BadRequestException('Invalid file type');
    const { pages, spine } = coercePages(body);
    if (fileType === 'PDF' && pages.length === 0) throw new BadRequestException('No rendered pages');
    if (fileType === 'EPUB' && spine.length === 0) throw new BadRequestException('No spine items');
    return { productId, bookId, watermarkSeed, fileType, pages, spine };
  }
}
