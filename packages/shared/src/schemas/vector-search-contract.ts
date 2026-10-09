// SSOT Phase 091 §3.1 — pgvector semantic search + AI RAG contract
// Canonical: packages/shared/src/schemas/vector-search-contract.ts
// - Spec-verbatim: VectorDistanceMetricEnum / ContentSourceTypeEnum /
//   VectorEmbeddingPayloadSchema / SemanticSearchInputSchema /
//   VectorSearchResultItemSchema / AiAskContextQuerySchema (§3.1).
// - RISK_CALL (documented): EMBEDDING_DIMS=1536 (spec canonical). Local
//   deterministic embedding engine ships in-backend (zero new deps;
//   OpenAI-compatible seam via port). Excerpts capped at 300 chars with a
//   forensic watermark tag (§8.1 DRM). Tenant isolation is mandatory on
//   every query (Gate 4).
// - Pure helpers: cosine similarity, chunking (300-500 words / 50 overlap),
//   excerpt cap + watermark, latency budgets, stream keys. Zod only.
import { z } from 'zod';

export const VectorDistanceMetricEnum = z.enum(['COSINE', 'EUCLIDEAN', 'INNER_PRODUCT']);
export type VectorDistanceMetric = z.infer<typeof VectorDistanceMetricEnum>;

export const ContentSourceTypeEnum = z.enum(['EBOOK_CHUNK', 'COURSE_TRANSCRIPT', 'PRODUCT_DESCRIPTION']);
export type ContentSourceType = z.infer<typeof ContentSourceTypeEnum>;

export const VectorEmbeddingPayloadSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  sourceType: ContentSourceTypeEnum,
  sourceId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  contentText: z.string().min(1),
  embedding: z.array(z.number()).length(1536),
  metadataJson: z.record(z.unknown()).optional(),
});
export type VectorEmbeddingPayload = z.infer<typeof VectorEmbeddingPayloadSchema>;

export const SemanticSearchInputSchema = z.object({
  tenantId: z.string().uuid(),
  queryText: z.string().min(2).max(500),
  sourceTypes: z.array(ContentSourceTypeEnum).optional(),
  productIdFilter: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(50).default(10),
  similarityThreshold: z.number().min(0.0).max(1.0).default(0.70),
});
export type SemanticSearchInput = z.infer<typeof SemanticSearchInputSchema>;

export const VectorSearchResultItemSchema = z.object({
  sourceType: ContentSourceTypeEnum,
  sourceId: z.string().uuid(),
  productId: z.string().uuid(),
  productTitle: z.string(),
  chunkIndex: z.number().int(),
  contentText: z.string(),
  similarityScore: z.number(),
  pageNumber: z.number().int().optional(),
  videoTimestampSec: z.number().int().optional(),
});
export type VectorSearchResultItem = z.infer<typeof VectorSearchResultItemSchema>;

export const AiAskContextQuerySchema = z.object({
  productId: z.string().uuid(),
  userQuestion: z.string().min(2).max(1000),
  currentPage: z.number().int().positive().optional(),
  chatHistory: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .optional(),
});
export type AiAskContextQuery = z.infer<typeof AiAskContextQuerySchema>;

/** Canonical embedding dimensions (OpenAI text-embedding-3-small). */
export const EMBEDDING_DIMS = 1536;
/** Chunking policy: 300-500 words, 50-word overlap (§7.1). */
export const CHUNK_WORDS_MIN = 300;
export const CHUNK_WORDS_MAX = 500;
export const CHUNK_OVERLAP_WORDS = 50;
/** AI excerpt DRM cap: 300 chars max per quote (§8.1). */
export const AI_EXCERPT_MAX_CHARS = 300;
/** Semantic search latency budget: p95 < 50ms (§10.1). */
export const SEMANTIC_SEARCH_P95_MS = 50;
/** Vector event stream (Gate 8 pipeline). */
export const VECTOR_STREAM = 'stream:vector:events';

/** Cosine similarity in [0,1] for non-negative embeddings (0 on degenerate). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Split text into word-window chunks (max words, overlap words). */
export function chunkText(text: string, maxWords = CHUNK_WORDS_MAX, overlapWords = CHUNK_OVERLAP_WORDS): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(words.length, start + maxWords);
    chunks.push(words.slice(start, end).join(' '));
    if (end >= words.length) break;
    start = end - overlapWords;
  }
  return chunks;
}

/** Cap an AI excerpt at 300 chars with ellipsis (DRM, §8.1). */
export function capExcerpt(text: string, max = AI_EXCERPT_MAX_CHARS): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Invisible forensic watermark tag binding an excerpt to a user. */
export function watermarkTag(userIdHash: string): string {
  return `⟦wm:${userIdHash}⟧`;
}

/** Similarity confidence badge label (0-1 score). */
export function similarityBadge(similarity: number): string {
  const pct = Math.round(Math.min(1, Math.max(0, similarity)) * 100);
  return `${pct}% Match`;
}
