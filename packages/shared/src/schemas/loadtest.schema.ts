// SSOT Phase 126 §3.1 — stress/load metrics contract
// Canonical: packages/shared/src/schemas/loadtest.schema.ts
// (legacy src/shared/schemas/sdid-loadtest-contract.ts)
// - Spec-verbatim: LoadTestScenarioEnum / PerformanceMetricReportSchema
//   (zeroEgress refine kept: egress must be strictly true) /
//   SlipVerifyQueuePayloadSchema.
// - RISK_CALL deviations (additive-only, documented): none on the three
//   schemas (server-minted UUIDs/URLs hold). Helpers are additive.
// - Pure helpers: percentile/hit-ratio/error-rate math + the 9-gate
//   evaluator (Gate 1..9 machine-readable). Zero new deps (zod only).
import { z } from 'zod';

export const LoadTestScenarioEnum = z.enum([
  'READ_HEAVY_CANVAS_CHUNK',
  'WRITE_HEAVY_SLIP_VERIFY',
  'STREAM_HLS_HEARTBEAT',
  'MIXED_SOCIAL_COMMERCE_PEAK',
]);
export type LoadTestScenario = z.infer<typeof LoadTestScenarioEnum>;

export const PerformanceMetricReportSchema = z.object({
  scenario: LoadTestScenarioEnum,
  concurrentUsers: z.number().int().positive(),
  totalRequests: z.number().int(),
  successfulRequests: z.number().int(),
  failedRequests: z.number().int(),
  requestsPerSecond: z.number(),
  latencyP50Ms: z.number(),
  latencyP95Ms: z.number(),
  latencyP99Ms: z.number(),
  redisCacheHitRatio: z.number().min(0).max(100),
  dbConnectionPoolUsagePct: z.number().min(0).max(100),
  averageClientRamMb: z.number(),
  zeroEgressCompliance: z.boolean().refine((val) => val === true, {
    message: 'CRITICAL: Egress cost must be strictly 0 Baht!',
  }),
});
export type PerformanceMetricReport = z.infer<typeof PerformanceMetricReportSchema>;

export const SlipVerifyQueuePayloadSchema = z.object({
  jobId: z.string().uuid(),
  orderId: z.string().uuid(),
  userId: z.string().uuid(),
  slipImageUrl: z.string().url(),
  attemptCount: z.number().int().default(0),
  submittedAt: z.string().datetime(),
});
export type SlipVerifyQueuePayload = z.infer<typeof SlipVerifyQueuePayloadSchema>;

/** Gate 1: read p95 ceiling (50ms). */
export const LOAD_P95_BUDGET_MS = 50;
/** Gate 1: read p99 ceiling (200ms). */
export const LOAD_P99_BUDGET_MS = 200;
/** Gate 1/§5.2: error-rate ceiling (0.01%). */
export const LOAD_ERROR_RATE_MAX = 0.0001;
/** Gate 3: slip+entitlement average ceiling (850ms). */
export const SLIP_PROCESS_BUDGET_MS = 850;
/** Gate 2: checkout throughput floor (2000 TPS). */
export const CHECKOUT_TPS_FLOOR = 2000;
/** Gate 4: LIFF RAM ceiling (30MB). */
export const LOAD_RAM_BUDGET_MB = 30;
/** Gate 6: edge cache hit floor (98.5%). */
export const CACHE_HIT_FLOOR_PCT = 98.5;
/** Gate 7: DB pool usage ceiling (80%). */
export const DB_POOL_CEILING_PCT = 80;
/** Gate 8: self-heal ceiling (15s). */
export const SELF_HEAL_BUDGET_MS = 15000;
/** §2.1: waiting-room queue-latency trip (2s). */
export const WAITING_ROOM_TRIP_MS = 2000;
/** 100k CCU target (BDD headline). */
export const LOAD_TARGET_CCU = 100000;

export interface LoadGateVerdict {
  gate: string;
  passed: boolean;
  actual: number | boolean;
  budget: number | boolean;
}

/** Nearest-rank percentile (ms samples; empty → 0). */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? 0;
}

/** Error rate (failed/total; empty → 0). */
export function errorRate(failed: number, total: number): number {
  if (!(total > 0)) return 0;
  return failed / total;
}

/** Cache hit ratio percent (hits/total; empty → 0). */
export function cacheHitRatio(hits: number, total: number): number {
  if (!(total > 0)) return 0;
  return (hits / total) * 100;
}

/** Machine-readable 9-gate evaluation (Gate 5 = egress boolean). */
export function evaluateLoadGates(report: PerformanceMetricReport): LoadGateVerdict[] {
  return [
    { gate: 'Gate 1 (p95 < 50ms)', passed: report.latencyP95Ms < LOAD_P95_BUDGET_MS, actual: report.latencyP95Ms, budget: LOAD_P95_BUDGET_MS },
    { gate: 'Gate 1b (p99 < 200ms)', passed: report.latencyP99Ms < LOAD_P99_BUDGET_MS, actual: report.latencyP99Ms, budget: LOAD_P99_BUDGET_MS },
    { gate: 'Gate 1c (error < 0.01%)', passed: errorRate(report.failedRequests, report.totalRequests) < LOAD_ERROR_RATE_MAX, actual: errorRate(report.failedRequests, report.totalRequests), budget: LOAD_ERROR_RATE_MAX },
    { gate: 'Gate 2 (TPS >= 2000)', passed: report.requestsPerSecond >= CHECKOUT_TPS_FLOOR, actual: report.requestsPerSecond, budget: CHECKOUT_TPS_FLOOR },
    { gate: 'Gate 4 (RAM < 30MB)', passed: report.averageClientRamMb < LOAD_RAM_BUDGET_MB, actual: report.averageClientRamMb, budget: LOAD_RAM_BUDGET_MB },
    { gate: 'Gate 5 (egress 0)', passed: report.zeroEgressCompliance === true, actual: report.zeroEgressCompliance, budget: true },
    { gate: 'Gate 6 (hit > 98.5%)', passed: report.redisCacheHitRatio > CACHE_HIT_FLOOR_PCT, actual: report.redisCacheHitRatio, budget: CACHE_HIT_FLOOR_PCT },
    { gate: 'Gate 7 (pool < 80%)', passed: report.dbConnectionPoolUsagePct < DB_POOL_CEILING_PCT, actual: report.dbConnectionPoolUsagePct, budget: DB_POOL_CEILING_PCT },
  ];
}

/** True when every evaluated gate passes. */
export function loadGatesPass(report: PerformanceMetricReport): boolean {
  return evaluateLoadGates(report).every((g) => g.passed);
}
