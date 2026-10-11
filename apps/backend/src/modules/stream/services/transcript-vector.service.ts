// SSOT Phase 091 §7.1 — Transcript vector ingest facade (thin delegate, Single Source §9)
// Canonical: apps/backend/src/modules/stream/services/transcript-vector.service.ts
// (legacy src/backend/modules/stream/services/transcript-vector.service.ts)
// - Video-transcript chunk ingest delegates to the single embedding engine
//   (EmbeddingGeneratorService) + single pgvector writer
//   (PgVectorRepositoryService). No duplicated embedding logic.
// - Chunks via shared chunkText (500-word window / 50-word overlap).
//   Metadata carries timestampSec when a base is provided (monotonic per
//   chunk index; genuine per-segment timestamps ride the caller payload).
// - Port-constructible for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { chunkText } from '@repo/shared';
import { EmbeddingGeneratorService } from '../../vector-search/services/embedding-generator.service';
import { PgVectorRepositoryService } from '../../vector-search/services/pgvector-repository.service';

@Injectable()
export class TranscriptVectorService {
  constructor(
    private readonly embeddings: EmbeddingGeneratorService,
    private readonly vectors: PgVectorRepositoryService,
  ) {}

  async ingestTranscript(args: {
    tenantId: string;
    productId: string;
    lessonId: string;
    transcriptText: string;
    timestampBaseSec?: number;
  }): Promise<number> {
    const chunks = chunkText(args.transcriptText);
    let idx = 0;
    for (const chunk of chunks) {
      const embedding = await this.embeddings.embed(chunk);
      await this.vectors.saveVectorEmbedding({
        tenantId: args.tenantId,
        productId: args.productId,
        sourceType: 'COURSE_TRANSCRIPT',
        sourceId: args.lessonId,
        chunkIndex: idx,
        contentText: chunk,
        embedding,
        metadataJson:
          args.timestampBaseSec != null ? { timestampSec: args.timestampBaseSec + idx } : {},
      });
      idx++;
    }
    return idx;
  }
}

// Back-compat alias for the early AUTO-SCAFFOLD double-suffixed name.
export { TranscriptVectorService as TranscriptVectorServiceService };
