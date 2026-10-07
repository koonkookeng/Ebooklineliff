// SSOT Phase 038 Task 6 — Book pipeline module (worker engine wiring)
// Canonical: apps/backend/src/modules/pipeline/pipeline.module.ts
// (legacy src/backend/modules/pipeline/pipeline.module.ts)
// NOTE: PrismaService + R2StorageService + RedisClusterService arrive via the
// global InfraModule / R2StorageModule (single pools).
import { Module } from '@nestjs/common';
import { R2StorageModule } from '../../infra/cloudflare/r2-storage.module';
import { SvgSanitizerService } from './domain/services/svg-sanitizer.service';
import { VectorCompressorService } from './domain/services/vector-compressor.service';
import { PdfVectorParserAdapter } from './infrastructure/parsers/pdf-vector-parser.adapter';
import { EpubParserAdapter } from './infrastructure/parsers/epub-parser.adapter';
import { R2VaultAdapter } from './infrastructure/storage/r2-vault.adapter';
import { EncryptAndUploadChunkUseCase } from './application/use-cases/encrypt-and-upload-chunk.use-case';
import { ProcessPdfToChunksUseCase } from './application/use-cases/process-pdf-to-chunks.use-case';
import { ProcessEpubToChunksUseCase } from './application/use-cases/process-epub-to-chunks.use-case';
import { BookPipelineProcessor } from './infrastructure/processors/book-pipeline.processor';
import { BookPipelineController } from './presentation/controllers/book-pipeline.controller';
import { BookPipelineResolver } from './presentation/resolvers/book-pipeline.resolver';

@Module({
  imports: [R2StorageModule],
  controllers: [BookPipelineController],
  providers: [
    SvgSanitizerService,
    VectorCompressorService,
    PdfVectorParserAdapter,
    EpubParserAdapter,
    R2VaultAdapter,
    EncryptAndUploadChunkUseCase,
    ProcessPdfToChunksUseCase,
    ProcessEpubToChunksUseCase,
    BookPipelineProcessor,
    BookPipelineResolver,
  ],
  exports: [BookPipelineProcessor, ProcessPdfToChunksUseCase, ProcessEpubToChunksUseCase],
})
export class PipelineModule {}
