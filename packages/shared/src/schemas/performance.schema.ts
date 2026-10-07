// SSOT Phase 029 §3.1 — Performance guard + predictive prefetch Zod SSOT contract
// Canonical: packages/shared/src/schemas/performance.schema.ts
// (spec §3.1 lives under src/shared/schemas/sdid-contract.ts; canonical maps to
// packages/shared/src per filefolder.md; dedicated file per zero-redundant policy)
// - Spec-verbatim: PerformanceMetricTypeEnum / BundleGuardMetricSchema /
//   PrefetchRequestSchema / PrefetchPayloadSchema.
// - RISK_CALL deviations (documented, additive-only):
//   - tenantId/userId/productId are z.string().min(1), not uuid: ids flow as opaque
//     strings at the edge (Phase 023–028 precedent); uuid strictness 400s valid
//     LIFF sessions (tenant slug 'default', seed ids).
//   - RUM ingest (TelemetryIngestSchema) is additive: web-vitals values arrive as
//     plain numbers via sendBeacon (no web-vitals dep on the client, Gate 5).
// - Zero new deps (zod only). Pure helpers (prefetchCacheKey, velocity count).
import { z } from 'zod';

export const PerformanceMetricTypeEnum = z.enum([
  'INITIAL_BUNDLE_SIZE',
  'LARGEST_CONTENTFUL_PAINT',
  'FIRST_INPUT_DELAY',
  'CUMULATIVE_LAYOUT_SHIFT',
  'PREFETCH_CACHE_HIT',
  'PREFETCH_CACHE_MISS',
]);
export type PerformanceMetricType = z.infer<typeof PerformanceMetricTypeEnum>;

export const BundleGuardMetricSchema = z.object({
  tenantId: z.string().min(1),
  bundleSizeBytes: z.number().int().positive().max(2097152, 'Bundle size strictly exceeds 2MB limit'),
  gzipSizeBytes: z.number().int().positive(),
  chunkCount: z.number().int().positive(),
  buildHash: z.string().min(8),
  timestamp: z.string().datetime(),
});
export type BundleGuardMetric = z.infer<typeof BundleGuardMetricSchema>;

export const PrefetchResourceTypeEnum = z.enum(['EBOOK_PAGE', 'COURSE_LESSON', 'PRODUCT_PDP']);
export type PrefetchResourceType = z.infer<typeof PrefetchResourceTypeEnum>;

export const PrefetchRequestSchema = z.object({
  userId: z.string().min(1),
  productId: z.string().min(1),
  currentResourceType: PrefetchResourceTypeEnum,
  currentResourceId: z.string().min(1),
  predictedNextResourceIds: z.array(z.string().min(1)).min(1).max(5),
});
export type PrefetchRequest = z.infer<typeof PrefetchRequestSchema>;

export const PrefetchPayloadSchema = z.object({
  success: z.boolean(),
  prefetchedCount: z.number().int().nonnegative(),
  cacheStorageKeys: z.array(z.string()),
  ttlSeconds: z.number().int().positive(),
});
export type PrefetchPayload = z.infer<typeof PrefetchPayloadSchema>;

/** RUM beacon body (LCP/FID/CLS + bundle + prefetch hit/miss, §7.1). */
export const TelemetryIngestSchema = z.object({
  metricType: PerformanceMetricTypeEnum,
  value: z.number().finite().nonnegative(),
  route: z.string().startsWith('/'),
  deviceMemory: z.number().int().positive().max(64).optional(),
  effectiveType: z.enum(['4g', '3g', '2g', 'slow-2g']).optional(),
});
export type TelemetryIngest = z.infer<typeof TelemetryIngestSchema>;

/** Hard initial-bundle ceiling (bytes) — BDD Scenario 1, Gate 1. */
export const BUNDLE_MAX_BYTES = 2 * 1024 * 1024;
/** Per-chunk ceiling (bytes) — splitChunks maxSize mirror (Gate 5). */
export const BUNDLE_CHUNK_MAX_BYTES = 500 * 1024;
/** Edge prefetch TTL (seconds) — 15 min signed-pointer window (§8.1). */
export const PREFETCH_TTL_SEC = 900;
/** Dwell threshold (ms) before predictive prefetch fires (BDD Scenario 2). */
export const PREFETCH_DWELL_MS = 1500;
/** Reading velocity (sec/page): faster than this → prefetch 3 ahead (§7.1). */
export const VELOCITY_FAST_SEC_PER_PAGE = 10;
/** Reading velocity (sec/page): slower than this → prefetch 1 ahead (§7.1). */
export const VELOCITY_SLOW_SEC_PER_PAGE = 45;
/** Redis pub/sub channel for RUM + prefetch telemetry (Gate 8). */
export const PERF_TELEMETRY_CHANNEL = 'performance.telemetry';

/** Edge-cache key for a predicted resource (backend + SW share the scheme). */
export function prefetchCacheKey(productId: string, resourceType: string, resourceId: string): string {
  return `prefetch:${productId}:${resourceType}:${resourceId}`;
}

/**
 * Map RUM/client metric vocabulary to the Prisma MetricType column vocabulary
 * (LARGEST_CONTENTFUL_PAINT → LCP_MS, FIRST_INPUT_DELAY → FID_MS,
 * CUMULATIVE_LAYOUT_SHIFT → CLS_SCORE; bundle/prefetch pass through).
 */
export function rumToMetricType(metric: PerformanceMetricType): string {
  switch (metric) {
    case 'LARGEST_CONTENTFUL_PAINT':
      return 'LCP_MS';
    case 'FIRST_INPUT_DELAY':
      return 'FID_MS';
    case 'CUMULATIVE_LAYOUT_SHIFT':
      return 'CLS_SCORE';
    default:
      return metric;
  }
}

/** Velocity-adaptive prefetch depth: 3 (fast) / 2 (cruise) / 1 (slow) (§7.1). */
export function velocityPrefetchCount(secondsPerPage: number): 1 | 2 | 3 {
  if (secondsPerPage < VELOCITY_FAST_SEC_PER_PAGE) return 3;
  if (secondsPerPage > VELOCITY_SLOW_SEC_PER_PAGE) return 1;
  return 2;
}
