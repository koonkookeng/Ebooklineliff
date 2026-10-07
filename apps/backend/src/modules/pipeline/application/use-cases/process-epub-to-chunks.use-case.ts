// SSOT Phase 038 Task 4 — EPUB→chunks use-case (spine fan-out, same downstream)
// Canonical: apps/backend/src/modules/pipeline/application/use-cases/process-epub-to-chunks.use-case.ts
// (legacy src/backend/modules/pipeline/application/use-cases/process-epub-to-chunks.use-case.ts)
// - Converts spine items to text-layer pages, then delegates page-for-page to
//   the PDF pipeline core (§9 — single downstream, no forked logic).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { EpubParserAdapter } from '../../infrastructure/parsers/epub-parser.adapter';
import { ProcessPdfToChunksUseCase, type PagePipelineResult } from './process-pdf-to-chunks.use-case';

export interface EpubSpineItem {
  idref: string;
  xhtmlContent: string;
}

@Injectable()
export class ProcessEpubToChunksUseCase {
  constructor(
    private readonly epub: EpubParserAdapter,
    private readonly pdfCore: ProcessPdfToChunksUseCase,
  ) {}

  async execute(
    bookId: string,
    productId: string,
    watermarkSeed: string,
    items: EpubSpineItem[],
    onProgress?: (processed: number, total: number, progress: number) => Promise<void> | void,
  ): Promise<PagePipelineResult[]> {
    const parsed = this.epub.parseToVectorSvgs(items);
    return this.pdfCore.execute(bookId, productId, watermarkSeed, parsed.pages, onProgress);
  }
}
