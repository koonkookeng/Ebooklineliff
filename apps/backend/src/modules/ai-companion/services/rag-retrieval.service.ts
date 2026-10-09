// SSOT Phase 092 Task 3 — RAG retrieval (tenant-isolated, DRM-capped)
// Canonical: apps/backend/src/modules/ai-companion/services/rag-retrieval.service.ts
// - RISK_CALL: vector search reuses Phase 091 PgVectorRepository (Single
//   Source per §9 — no duplicate pgvector code). DRM cap (≤3) enforced here.
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { AI_MAX_CONTEXT_CHUNKS } from '@repo/shared';
import { EmbeddingGeneratorService } from '../../vector-search/services/embedding-generator.service';
import { PgVectorRepositoryService } from '../../vector-search/services/pgvector-repository.service';
import { capContextChunks } from '../guardrails/drm-protection.guardrail';

export interface CompanionChunk {
  chunkIndex: number;
  contentText: string;
  similarity: number;
  pageNumber?: number;
  timestampSec?: number;
}

@Injectable()
export class RagRetrievalService {
  constructor(
    private readonly embeddings: EmbeddingGeneratorService,
    private readonly vectors: PgVectorRepositoryService,
  ) {}

  async retrieve(args: {
    tenantId: string;
    productId: string;
    question: string;
    limit?: number;
  }): Promise<CompanionChunk[]> {
    const queryVector = await this.embeddings.embed(args.question);
    const rows = await this.vectors.searchSimilarVectors(
      queryVector,
      0.0,
      args.limit ?? AI_MAX_CONTEXT_CHUNKS,
      args.tenantId,
      args.productId,
    );
    return capContextChunks(
      rows.map((r) => {
        const meta = (r.metadata_json ?? {}) as { pageNumber?: number; timestampSec?: number };
        const chunk: CompanionChunk = {
          chunkIndex: r.chunk_index,
          contentText: r.content_text,
          similarity: r.similarity,
        };
        if (typeof meta.pageNumber === 'number') chunk.pageNumber = meta.pageNumber;
        if (typeof meta.timestampSec === 'number') chunk.timestampSec = meta.timestampSec;
        return chunk;
      }),
    );
  }
}
