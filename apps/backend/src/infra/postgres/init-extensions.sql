-- SSOT Phase 002 §4.1 — enable core enterprise extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Verify extensions baseline
DO $$
BEGIN
   IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
      RAISE EXCEPTION 'pgvector extension failed to initialize!';
   END IF;
END $$;

-- Optimize vector cosine distance indexing baseline
-- Example table for AI content embeddings & RAG summarizer
CREATE TABLE IF NOT EXISTS content_vector_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_type VARCHAR(50) NOT NULL, -- 'EBOOK_CHUNK', 'LESSON_TRANSCRIPT'
    reference_id UUID NOT NULL,
    chunk_index INT NOT NULL,
    embedding vector(1536), -- Standard OpenAI/Local LLM embedding size
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create high-performance HNSW index for vector search
CREATE INDEX IF NOT EXISTS idx_content_vector_hnsw
ON content_vector_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
