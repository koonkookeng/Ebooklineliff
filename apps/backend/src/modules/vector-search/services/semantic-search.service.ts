// SSOT Phase 091 BDD-1 — Hybrid semantic search (Zod gate → embed → pgvector)
// Canonical: apps/backend/src/modules/vector-search/services/semantic-search.service.ts
// - Flow: SemanticSearchInputSchema gate -> embed query -> tenant-isolated
//   HNSW search (Gate 4) -> enrich product titles -> threshold sort.
//   p95 budget 50ms tracked per call (Gate 8 telemetry field).
// - Port-based for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { SemanticSearchInputSchema, VECTOR_STREAM } from '@repo/shared';
import { EmbeddingGeneratorService } from './embedding-generator.service';
import { PgVectorRepositoryService } from './pgvector-repository.service';

export interface SearchBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

export interface ProductTitlePort {
  findTitles(productIds: string[]): Promise<Record<string, string>>;
}

@Injectable()
export class SemanticSearchService {
  constructor(
    private readonly embeddings: EmbeddingGeneratorService,
    private readonly vectors: PgVectorRepositoryService,
    private readonly titles: ProductTitlePort,
    private readonly bus?: SearchBus,
  ) {}

  async execute(input: {
    tenantId: string;
    queryText: string;
    sourceTypes?: string[];
    productIdFilter?: string;
    limit?: number;
    similarityThreshold?: number;
  }): Promise<{
    items: Array<{
      sourceType: string;
      sourceId: string;
      productId: string;
      productTitle: string;
      chunkIndex: number;
      contentText: string;
      similarityScore: number;
      pageNumber?: number;
      videoTimestampSec?: number;
    }>;
    tookMs: number;
  }> {
    const parsed = SemanticSearchInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid semantic search input');
    const t0 = Date.now();

    const queryVector = await this.embeddings.embed(parsed.data.queryText);
    const rows = await this.vectors.searchSimilarVectors(
      queryVector,
      parsed.data.similarityThreshold,
      parsed.data.limit,
      parsed.data.tenantId,
      parsed.data.productIdFilter,
    );

    const allowed = parsed.data.sourceTypes as string[] | undefined;
    const filtered = allowed?.length
      ? rows.filter((r) => allowed.includes(r.source_type))
      : rows;
    const titles = await this.titles.findTitles([...new Set(filtered.map((r) => r.product_id))]);
    const items = filtered.map((r) => {
      const meta = (r.metadata_json ?? {}) as { pageNumber?: number; timestampSec?: number };
      const item: {
        sourceType: string; sourceId: string; productId: string; productTitle: string;
        chunkIndex: number; contentText: string; similarityScore: number;
        pageNumber?: number; videoTimestampSec?: number;
      } = {
        sourceType: r.source_type,
        sourceId: r.source_id,
        productId: r.product_id,
        productTitle: titles[r.product_id] ?? 'เนื้อหา',
        chunkIndex: r.chunk_index,
        contentText: r.content_text,
        similarityScore: Math.round(r.similarity * 1000) / 1000,
      };
      if (typeof meta.pageNumber === 'number') item.pageNumber = meta.pageNumber;
      if (typeof meta.timestampSec === 'number') item.videoTimestampSec = meta.timestampSec;
      return item;
    });
    const tookMs = Date.now() - t0;
    await this.bus
      ?.xadd(VECTOR_STREAM, {
        event: 'semantic_search',
        tenantId: parsed.data.tenantId,
        resultCount: items.length,
        tookMs,
        at: Date.now(),
      })
      .catch(() => undefined);
    return { items, tookMs };
  }
}
