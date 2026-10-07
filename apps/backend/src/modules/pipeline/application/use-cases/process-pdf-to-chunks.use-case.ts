// SSOT Phase 038 Task 4 — PDF→chunks use-case (pipeline core per page)
// Canonical: apps/backend/src/modules/pipeline/application/use-cases/process-pdf-to-chunks.use-case.ts
// (legacy src/backend/modules/pipeline/application/use-cases/process-pdf-to-chunks.use-case.ts)
// - Stages per page: normalize → sanitize → compress → entity-guard (50KB) →
//   encrypt+upload → chunk upsert → text upsert → progress callback.
// - Chunk/text rows upsert by @@unique (idempotent retries, Gate 7); BigInt is
//   untouched here (chunkSizeBytes is Int per spec).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import { PdfVectorParserAdapter } from '../../infrastructure/parsers/pdf-vector-parser.adapter';
import { SvgSanitizerService } from '../../domain/services/svg-sanitizer.service';
import { VectorCompressorService } from '../../domain/services/vector-compressor.service';
import { EncryptAndUploadChunkUseCase } from './encrypt-and-upload-chunk.use-case';
import { VectorPage } from '../../domain/entities/vector-page.entity';
import { chunkR2Path, progressFor, type PagePayload } from '@repo/shared';

export interface PagePipelineResult {
  pageNumber: number;
  r2ObjectKey: string;
  chunkSizeBytes: number;
  vectorChecksum: string;
  textLength: number;
}

interface PipelineTables {
  ebookDetail: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
  ebookChunk: {
    upsert: (args: unknown) => Promise<unknown>;
  };
  ebookPageText: {
    upsert: (args: unknown) => Promise<unknown>;
  };
}

@Injectable()
export class ProcessPdfToChunksUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: PdfVectorParserAdapter,
    private readonly sanitizer: SvgSanitizerService,
    private readonly compressor: VectorCompressorService,
    private readonly encryptUpload: EncryptAndUploadChunkUseCase,
  ) {}

  private get tables(): PipelineTables {
    return this.prisma as unknown as PipelineTables;
  }

  async execute(
    bookId: string,
    productId: string,
    watermarkSeed: string,
    pages: PagePayload[],
    onProgress?: (processed: number, total: number, progress: number) => Promise<void> | void,
  ): Promise<PagePipelineResult[]> {
    const parsed = this.parser.parseToVectorSvgs(pages);
    const ebook = await this.tables.ebookDetail.findFirst({ where: { productId } });
    if (!ebook) throw new Error('EbookDetail record not found');
    const out: PagePipelineResult[] = [];
    for (const page of parsed.pages) {
      const clean = this.sanitizer.sanitize(page.svgContent);
      const compressed = this.compressor.compress(clean).output;
      const guarded = VectorPage.create({ pageNumber: page.pageNumber, svgContent: compressed, extractedText: page.extractedText });
      const objectKey = chunkR2Path(bookId, guarded.props.pageNumber);
      const envelope = await this.encryptUpload.execute(objectKey, guarded.props.svgContent, watermarkSeed, bookId);
      const sizeBytes = Buffer.byteLength(guarded.props.svgContent, 'utf8');
      await this.tables.ebookChunk.upsert({
        where: { ebookDetailId_pageNumber: { ebookDetailId: ebook.id, pageNumber: guarded.props.pageNumber } },
        update: { chunkR2Path: objectKey, fileSizeBytes: sizeBytes, chunkHash: envelope.hash },
        create: { ebookDetailId: ebook.id, pageNumber: guarded.props.pageNumber, chunkR2Path: objectKey, fileSizeBytes: sizeBytes, chunkHash: envelope.hash },
      });
      await this.tables.ebookPageText.upsert({
        where: { ebookDetailId_pageNumber: { ebookDetailId: ebook.id, pageNumber: guarded.props.pageNumber } },
        update: { extractedText: guarded.props.extractedText },
        create: { ebookDetailId: ebook.id, pageNumber: guarded.props.pageNumber, extractedText: guarded.props.extractedText },
      });
      out.push({ pageNumber: guarded.props.pageNumber, r2ObjectKey: objectKey, chunkSizeBytes: sizeBytes, vectorChecksum: envelope.hash, textLength: guarded.props.extractedText.length });
      await onProgress?.(guarded.props.pageNumber, parsed.totalPages, progressFor(guarded.props.pageNumber, parsed.totalPages));
    }
    return out;
  }
}
