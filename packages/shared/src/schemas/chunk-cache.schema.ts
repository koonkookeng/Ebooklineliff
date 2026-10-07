// SSOT Phase 039 §3.1 — Redis Edge chunk-cache Zod contract
// Canonical: packages/shared/src/schemas/chunk-cache.schema.ts
// (legacy src/shared/schemas/chunk-cache.schema.ts)
// - Spec-verbatim: ChunkCacheKeyParamsSchema / RedisChunkPayloadSchema /
//   CacheMetricsSchema (§3.1 Gate 1).
// - Additive helpers (zero-dep): CHUNK_CACHE_TTL_SEC (24h sliding window),
//   EDGE_HIT_SLA_MS (10ms BDD budget), EDGE_SELFHEAL_MS (15ms §10 guard),
//   buildChunkCacheKey(), slidingWindowPages(), chunkR2ObjectKey().
// - Key format mirrors §4.1: tenant:{tenantId}:ebook:{productId}:page:{n}:chunk
import { z } from 'zod';

export const ChunkCacheKeyParamsSchema = z.object({
  tenantId: z.string().min(1),
  productId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
});
export type ChunkCacheKeyParams = z.infer<typeof ChunkCacheKeyParamsSchema>;

export const RedisChunkPayloadSchema = z.object({
  pageNumber: z.number().int().positive(),
  vectorSvgContent: z.string().min(1),
  compressedSizeByte: z.number().int().nonnegative(),
  isEncrypted: z.boolean().default(true),
  cachedAt: z.string().datetime(),
  ttlSeconds: z.number().int().default(86400),
});
export type RedisChunkPayload = z.infer<typeof RedisChunkPayloadSchema>;

export const CacheMetricsSchema = z.object({
  hitRatio: z.number().min(0).max(100),
  averageLatencyMs: z.number().nonnegative(),
  keysCount: z.number().int().nonnegative(),
  memoryUsedMb: z.number().nonnegative(),
});
export type CacheMetrics = z.infer<typeof CacheMetricsSchema>;

/** Sliding-window TTL (24h) — every read renews via EXPIRE (§4.1). */
export const CHUNK_CACHE_TTL_SEC = 86400;
/** BDD Scenario 1 budget: edge HIT must land within 10ms. */
export const EDGE_HIT_SLA_MS = 10;
/** §10 self-heal guard: latency >15ms falls back to L1 in-memory cache. */
export const EDGE_SELFHEAL_MS = 15;
/** Async R2→Edge warm budget on cache miss (BDD Scenario 2: <50ms). */
export const EDGE_WARM_BUDGET_MS = 50;
/** Client sliding window: current ±1, GC N-2 (RAM <30MB, §2.1). */
export const CHUNK_WINDOW_RADIUS = 1;

/** §4.1 canonical key: tenant:{t}:ebook:{p}:page:{n}:chunk */
export function buildChunkCacheKey(params: ChunkCacheKeyParams): string {
  return `tenant:${params.tenantId}:ebook:${params.productId}:page:${params.pageNumber}:chunk`;
}

/** SCAN match pattern for instant invalidation on content update (§BDD-3). */
export function chunkInvalidationPattern(tenantId: string, productId: string): string {
  return `tenant:${tenantId}:ebook:${productId}:page:*:chunk`;
}

/** Sliding window [N-1, N, N+1] filtered to positive pages. */
export function slidingWindowPages(currentPage: number): number[] {
  return [currentPage - CHUNK_WINDOW_RADIUS, currentPage, currentPage + CHUNK_WINDOW_RADIUS].filter(
    (p) => Number.isInteger(p) && p > 0,
  );
}

/** Zero-egress R2 origin key for a page chunk (Phase 036 vault layout). */
export function chunkR2ObjectKey(productId: string, pageNumber: number): string {
  return `ebooks/${productId}/chunks/page-${pageNumber}.enc`;
}
