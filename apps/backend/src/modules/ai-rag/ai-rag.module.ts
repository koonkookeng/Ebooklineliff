// SSOT Phase 091 §5.1 — AiRag module wiring (service-only, consumed by vector-search)
// Canonical: apps/backend/src/modules/ai-rag/ai-rag.module.ts
// - RAG builder + summarizer exports; GQL/REST intents live in the
//   vector-search module (single intent surface). Zero new deps.
import { Module } from '@nestjs/common';
import { EmbeddingGeneratorService } from '../vector-search/services/embedding-generator.service';
import { PgVectorRepositoryService } from '../vector-search/services/pgvector-repository.service';
import { RagContextBuilderService } from './services/rag-context-builder.service';
import { AiSummarizerService } from './services/ai-summarizer.service';

@Module({
  providers: [EmbeddingGeneratorService, PgVectorRepositoryService, RagContextBuilderService, AiSummarizerService],
  exports: [RagContextBuilderService, AiSummarizerService],
})
export class AiRagModule {}
