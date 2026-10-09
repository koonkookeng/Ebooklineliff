-- SSOT Phase 091 §4.1 — pgvector HNSW + hybrid search companion
-- Companion to: packages/db/prisma/schema.prisma (ContentVectorEmbedding)
-- NOTE: Prisma cannot express HNSW indexes or SQL functions — this file is
-- the DBA companion (same standing as infra/postgres/init-extensions.sql).
-- It is NOT a Prisma migration: no table is created here (Prisma owns DDL).
-- Apply once per database after `prisma db push`.

-- HNSW index for ultra-fast cosine-distance search (recall > 96%).
CREATE INDEX IF NOT EXISTS content_vector_embedding_hnsw_idx
ON "ContentVectorEmbedding"
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Hybrid semantic search with mandatory tenant isolation (Gate 4).
CREATE OR REPLACE FUNCTION match_content_vectors(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_tenant_id text,
  p_product_id text DEFAULT NULL
)
RETURNS TABLE (
  id text,
  product_id text,
  source_type "ContentSourceType",
  source_id text,
  chunk_index int,
  content_text text,
  metadata_json jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c."productId",
    c."sourceType",
    c."sourceId",
    c."chunkIndex",
    c."contentText",
    c."metadataJson",
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM "ContentVectorEmbedding" c
  WHERE c."tenantId" = p_tenant_id
    AND (p_product_id IS NULL OR c."productId" = p_product_id)
    AND 1 - (c.embedding <=> query_embedding) >= match_threshold
  ORDER BY c.embedding <=> query_embedding ASC
  LIMIT match_count;
END;
$$;
