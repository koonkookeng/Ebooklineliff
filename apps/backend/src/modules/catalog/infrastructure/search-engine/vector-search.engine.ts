// SSOT Phase 009 §5.1/§7.1 — Vector hybrid-search helpers (pure, unit-tested)
// Canonical: apps/backend/src/modules/catalog/infrastructure/search-engine/vector-search.engine.ts
// pgvector HNSW (cosine) is the semantic fallback when FTS returns < limit rows.
// Embeddings are 768-dim (Gemini/Text-Embedding-004); this module never touches the network.

export const VECTOR_DIMS = 768;

/** Validate an embedding vector (fail-fast with context, no silent truncation). */
export function assertValidEmbedding(vec: number[]): void {
  if (!Array.isArray(vec) || vec.length !== VECTOR_DIMS) {
    throw new Error(`Invalid embedding: expected ${VECTOR_DIMS} dims, got ${Array.isArray(vec) ? vec.length : typeof vec}`);
  }
  for (const v of vec) {
    if (!Number.isFinite(v)) throw new Error('Invalid embedding: non-finite component');
  }
}

/** Cosine similarity in [-1, 1] (pure; used for in-memory re-rank of small candidate sets). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Reciprocal Rank Fusion of FTS rank + vector rank.
 * inputs: ordered id lists (best-first). output: fused ordered ids, topK capped.
 */
export function reciprocalRankFusion(ftsIds: string[], vectorIds: string[], topK = 5, k = 60): string[] {
  const scores = new Map<string, number>();
  const add = (ids: string[]): void => {
    ids.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  };
  add(ftsIds);
  add(vectorIds);
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, Math.min(10, topK)))
    .map(([id]) => id);
}

/** Build a parametrized HNSW cosine query (values bound by caller — no interpolation). */
export function buildVectorSearchSql(_limit: number): string {
  return `SELECT id FROM "Product"
    WHERE "isPublished" = true AND "deletedAt" IS NULL AND "embedding" IS NOT NULL
    ORDER BY "embedding" <=> $1::vector LIMIT $2;`;
}
