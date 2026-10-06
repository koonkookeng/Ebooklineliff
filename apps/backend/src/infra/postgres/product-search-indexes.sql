-- SSOT Phase 009 §4.2 — Product hybrid search indexes (idempotent; applied by init job, not manual migration)
-- Requires: pg_trgm + vector extensions (see init-extensions.sql). Safe to re-run (IF NOT EXISTS).
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Full-text GIN index over title+description (Thai/English trigram fallback when tsvector lacks Thai dict).
CREATE INDEX IF NOT EXISTS product_title_trgm_idx ON "Product" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS product_search_trgm_idx ON "Product" USING GIN (("title" || ' ' || "description") gin_trgm_ops);

-- Facet / filter B-tree indexes (tenant + type + price + rating + published flag).
CREATE INDEX IF NOT EXISTS product_tenant_type_idx ON "Product" ("tenantId", "productType");
CREATE INDEX IF NOT EXISTS product_price_idx ON "Product" ("price");
CREATE INDEX IF NOT EXISTS product_rating_idx ON "Product" ("ratingAverage" DESC);
CREATE INDEX IF NOT EXISTS product_published_idx ON "Product" ("isPublished") WHERE "isPublished" = true;

-- Semantic vector HNSW index (768-dim Gemini/Text-Embedding-004). NULL embeddings are skipped by HNSW.
-- NOTE: column "embedding" is created by Prisma (Unsupported vector(768)); this only adds the index.
CREATE INDEX IF NOT EXISTS product_embedding_hnsw_idx ON "Product"
  USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
