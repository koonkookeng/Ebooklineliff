// SSOT Phase 128 §3.1 — query performance & DB health contract
// Canonical: packages/shared/src/schemas/query-performance.schema.ts
// (legacy src/shared/schemas/sdid-contract.ts)
// - Spec-verbatim: QueryPerformanceMetricSchema (4 scan types incl.
//   BITMAP_INDEX_SCAN) / DatabaseHealthStatusSchema /
//   EbookChunkQueryInputSchema (uuid/user/product/page).
// - RISK_CALL deviations (additive-only, documented):
//   - queryHash/rawSql accept min(1) (spec bare string() is the narrow
//     case; 023-031 precedent for id/hash fields).
//   - uuid fields use min(1): hashes/sealed ids flow through the same
//     lanes as uuids (023-031 precedent).
// - Pure helpers: slow-query verdict, EXPLAIN scan ranking, SLA budgets,
//   cache-key builders. Zero new deps (zod only).
import { z } from 'zod';

export const QueryScanTypeEnum = z.enum([
  'INDEX_ONLY_SCAN',
  'INDEX_SCAN',
  'BITMAP_INDEX_SCAN',
  'SEQUENTIAL_SCAN',
]);
export type QueryScanType = z.infer<typeof QueryScanTypeEnum>;

export const QueryPerformanceMetricSchema = z.object({
  queryHash: z.string().min(1),
  rawSql: z.string().min(1),
  executionTimeMs: z.number().nonnegative(),
  planningTimeMs: z.number().nonnegative(),
  scanType: QueryScanTypeEnum,
  rowsProcessed: z.number().int().nonnegative(),
  isSlowQuery: z.boolean(),
});
export type QueryPerformanceMetric = z.infer<typeof QueryPerformanceMetricSchema>;

export const DatabaseHealthStatusSchema = z.object({
  activeConnections: z.number().int().nonnegative(),
  idleConnections: z.number().int().nonnegative(),
  waitingQueries: z.number().int().nonnegative(),
  cacheHitRatioPercent: z.number().min(0).max(100),
  indexHitRatioPercent: z.number().min(0).max(100),
});
export type DatabaseHealthStatus = z.infer<typeof DatabaseHealthStatusSchema>;

export const EbookChunkQueryInputSchema = z.object({
  productId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  userId: z.string().min(1),
});
export type EbookChunkQueryInput = z.infer<typeof EbookChunkQueryInputSchema>;

/** §5.2: slow-query tripwire (> 50ms warns). */
export const SLOW_QUERY_MS = 50;
/** §10.1: self-healing inspector tripwire (> 10ms investigates). */
export const QUERY_INSPECT_MS = 10;
/** BDD-1: entitlement verification ceiling (2ms index-only). */
export const ENTITLEMENT_VERIFY_BUDGET_MS = 2;
/** BDD-2: 100-order batched resolution ceiling (15ms, exactly 3 SQL). */
export const ORDER_BATCH_BUDGET_MS = 15;
export const ORDER_BATCH_QUERY_COUNT = 3;
/** BDD-3: slip transRef lookup ceiling (1ms unique index). */
export const SLIP_LOOKUP_BUDGET_MS = 1;
/** Gate 7: DB timeout fallback ceiling (50ms -> Redis backup). */
export const DB_TIMEOUT_FALLBACK_MS = 50;
/** §2.2: LIFF state latency budgets. */
export const LIFF_INIT_DB_BUDGET_MS = 10;
export const IDLE_CACHE_BUDGET_MS = 2;
export const LOADING_BATCH_BUDGET_MS = 15;
export const SUCCESS_RENDER_DB_BUDGET_MS = 5;
/** §6.1: chunk fetch ceilings (cache-hit / cold-read). */
export const CHUNK_CACHE_HIT_BUDGET_MS = 8;
export const CHUNK_COLD_READ_BUDGET_MS = 18;
/** Business goal: p99 query latency ceiling + 10k QPS target. */
export const P99_QUERY_BUDGET_MS = 5;
export const TARGET_QPS = 10000;
/** §8.1: PgBouncer pool sizing. */
export const POOL_SIZE = 50;
export const POOL_RESERVE = 10;
export const POOL_MAX_DB_CONNECTIONS = 200;

/** True when a query trips the slow-query guard (§5.2). */
export function isSlowQuery(executionTimeMs: number): boolean {
  return executionTimeMs > SLOW_QUERY_MS;
}

/** True when a query deserves the self-healing inspector (§10.1). */
export function needsInspect(executionTimeMs: number): boolean {
  return executionTimeMs > QUERY_INSPECT_MS;
}

/** Rank EXPLAIN scan types (higher = healthier plan). */
export function scanRank(scan: QueryScanType): number {
  return {
    INDEX_ONLY_SCAN: 3,
    INDEX_SCAN: 2,
    BITMAP_INDEX_SCAN: 1,
    SEQUENTIAL_SCAN: 0,
  }[scan];
}

/** True when the plan avoids sequential scans (BDD-1 zero-seqscan rule). */
export function planIsIndexed(scan: QueryScanType): boolean {
  return scan !== 'SEQUENTIAL_SCAN';
}

/** Edge cache key for a query hash (shared with cache-query lane). */
export function cachedQueryKey(queryHash: string): string {
  return `perf:query:{${queryHash}}`;
}

/** Edge cache key for an ebook chunk read (039 lane compatible). */
export function chunkReadKey(productId: string, pageNumber: number): string {
  return `ebook:chunk:{${productId}}:${pageNumber}`;
}
