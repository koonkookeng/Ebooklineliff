// SSOT Phase 040 §3.1 — Reader engine Zod contract
// Canonical: packages/shared/src/schemas/reader.schema.ts
// (legacy src/shared/schemas/reader.schema.ts)
// - Spec-verbatim: ForensicWatermarkSchema / EbookChunkPayloadSchema /
//   ReaderProgressPayloadSchema (§3.1 Gate 1).
// - Additive helpers (zero-dep): READER_CHUNK_TTL_SEC (24h, §4.1), RAM budgets
//   (§5 Gate 5), page-window helpers shared with the canvas hook.
// - RISK_CALL (documented, additive-only): transport reuses the Phase 039
//   tenant-isolated edge key (tenant:{t}:ebook:{p}:page:{n}:chunk) instead of
//   the §4.1 bare `reader:chunk:{p}:{n}` — multi-tenant isolation (§2.1)
//   wins over the bare pattern; readerLegacyCacheKey() preserves the §4.1
//   shape for observability parity.
import { z } from 'zod';

export const ForensicWatermarkSchema = z.object({
  watermarkText: z.string().min(1),
  userIdHash: z.string().min(1),
  userIp: z.string().optional(),
  timestamp: z.string().datetime(),
});
export type ForensicWatermark = z.infer<typeof ForensicWatermarkSchema>;

export const EbookChunkPayloadSchema = z.object({
  productId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  totalPages: z.number().int().positive(),
  vectorSvgContent: z.string().min(1),
  forensicWatermark: ForensicWatermarkSchema,
  hasPrevious: z.boolean(),
  hasNext: z.boolean(),
});
export type EbookChunkPayload = z.infer<typeof EbookChunkPayloadSchema>;

export const ReaderProgressPayloadSchema = z.object({
  productId: z.string().uuid(),
  lastPage: z.number().int().positive(),
  readDurationSec: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
});
export type ReaderProgressPayload = z.infer<typeof ReaderProgressPayloadSchema>;

export const ProgressSyncResultSchema = z.object({
  success: z.boolean(),
  lastPage: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});
export type ProgressSyncResult = z.infer<typeof ProgressSyncResultSchema>;

/** §4.1 edge TTL (24h, LRU auto-eviction). */
export const READER_CHUNK_TTL_SEC = 86400;
/** Gate 5: LIFF heap ceiling — canvas aborts prefetch above this. */
export const READER_RAM_BUDGET_MB = 30;
/** Gate 5: warning threshold for the RAM badge (§6.1 overlay). */
export const READER_RAM_WARN_MB = 28;
/** Sliding-window radius: [N-1, N, N+1]. */
export const READER_WINDOW_RADIUS = 1;

/** §4.1 legacy key shape (observability parity only — transport uses Phase 039 tenant keys). */
export function readerLegacyCacheKey(productId: string, pageNumber: number): string {
  return `reader:chunk:${productId}:${pageNumber}`;
}

/** Window [N-1, N, N+1] filtered to positive integer pages. */
export function readerWindowPages(currentPage: number): number[] {
  return [currentPage - READER_WINDOW_RADIUS, currentPage, currentPage + READER_WINDOW_RADIUS].filter(
    (p) => Number.isInteger(p) && p > 0,
  );
}

/** BDD-2 GC rule: pages falling outside the new window are evicted. */
export function readerEvictedPages(previous: number[], next: number[]): number[] {
  const keep = new Set(next);
  return previous.filter((p) => !keep.has(p));
}
