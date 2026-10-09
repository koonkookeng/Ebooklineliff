// SSOT Phase 091 §5.2 — pgvector repository (native SQL wrapper, tenant-isolated)
// Canonical: apps/backend/src/modules/vector-search/services/pgvector-repository.service.ts
// - searchSimilarVectors calls match_content_vectors (HNSW, Gate 4 tenant
//   filter mandatory). saveVectorEmbedding batch-inserts one row.
// - Port-based (RawSqlPort) for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';

export interface VectorMatchResult {
  id: string;
  product_id: string;
  source_type: string;
  source_id: string;
  chunk_index: number;
  content_text: string;
  metadata_json: Record<string, unknown> | null;
  similarity: number;
}

export interface RawSqlPort {
  queryRawUnsafe<T>(sql: string, ...args: Array<string | number | null>): Promise<T>;
  executeRawUnsafe(sql: string, ...args: Array<string | number | null>): Promise<unknown>;
}

@Injectable()
export class PgVectorRepositoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly raw?: RawSqlPort,
  ) {}

  private get db(): RawSqlPort {
    if (this.raw) return this.raw;
    const p = this.prisma as unknown as RawSqlPort;
    return {
      queryRawUnsafe: <T>(sql: string, ...args: Array<string | number | null>) =>
        (p.queryRawUnsafe as (sql: string, ...a: Array<string | number | null>) => Promise<T>)(sql, ...args),
      executeRawUnsafe: (sql: string, ...args: Array<string | number | null>) =>
        (p.executeRawUnsafe as (sql: string, ...a: Array<string | number | null>) => Promise<unknown>)(sql, ...args),
    };
  }

  async searchSimilarVectors(
    queryVector: number[],
    threshold: number,
    limit: number,
    tenantId: string,
    productId?: string,
  ): Promise<VectorMatchResult[]> {
    const vectorString = `[${queryVector.join(',')}]`;
    return await this.db.queryRawUnsafe<VectorMatchResult[]>(
      `SELECT * FROM match_content_vectors(
        $1::vector,
        $2::float,
        $3::int,
        $4::text,
        $5::text
      )`,
      vectorString,
      threshold,
      limit,
      tenantId,
      productId ?? null,
    );
  }

  async saveVectorEmbedding(data: {
    tenantId: string;
    productId: string;
    sourceType: string;
    sourceId: string;
    chunkIndex: number;
    contentText: string;
    embedding: number[];
    metadataJson?: Record<string, unknown>;
  }): Promise<void> {
    const vectorString = `[${data.embedding.join(',')}]`;
    await this.db.executeRawUnsafe(
      `INSERT INTO "ContentVectorEmbedding"
        ("id", "tenantId", "productId", "sourceType", "sourceId", "chunkIndex", "contentText", "embedding", "metadataJson", "createdAt", "updatedAt")
       VALUES
        (gen_random_uuid(), $1, $2, $3::"ContentSourceType", $4, $5, $6, $7::vector, $8::jsonb, NOW(), NOW())`,
      data.tenantId,
      data.productId,
      data.sourceType,
      data.sourceId,
      data.chunkIndex,
      data.contentText,
      vectorString,
      JSON.stringify(data.metadataJson ?? {}),
    );
  }
}
