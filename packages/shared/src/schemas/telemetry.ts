// SSOT Phase 130 §3.1 — production telemetry & go-live audit contract
// Canonical: packages/shared/src/schemas/telemetry.ts
// (legacy src/shared/schemas/telemetry.ts — exact filename mapping)
// - Spec-verbatim: ProductionHealthStatusEnum / GoLiveAuditReportSchema
//   (overallScore min(100).max(100) — 100-or-nothing gate) /
//   SystemMetricsTelemetrySchema (cacheHitRatio min 0.90, slipP99 max 800,
//   egress literal 0, canvas RAM max 30.0).
// - RISK_CALL deviations (additive-only, documented):
//   - deploymentId accepts min(1) (spec uuid() is the narrow case;
//     release tags like app:v1.130.0-<sha> flow through this lane,
//     023-031 precedent).
// - Pure helpers: gate rollup, telemetry verdicts, rollout budgets.
//   Zero new deps (zod only). Distinct from the 121 logging lane
//   (telemetry-contract.ts) — this file owns go-live gates.
import { z } from 'zod';

export const ProductionHealthStatusEnum = z.enum([
  'HEALTHY',
  'DEGRADED',
  'MAINTENANCE',
  'CRITICAL_FAILURE',
]);
export type ProductionHealthStatus = z.infer<typeof ProductionHealthStatusEnum>;

export const GoLiveAuditReportSchema = z.object({
  deploymentId: z.string().min(1),
  timestamp: z.string().datetime(),
  environment: z.literal('production'),
  gatekeeperStatus: z.object({
    schemaSync: z.boolean(),
    typeSafety: z.boolean(),
    liffRamCheck: z.boolean(),
    zeroEgressCheck: z.boolean(),
    slipVerifyLatencyMs: z.number().max(1000),
    securityPenTestPassed: z.boolean(),
  }),
  overallScore: z.number().min(100).max(100),
});
export type GoLiveAuditReport = z.infer<typeof GoLiveAuditReportSchema>;

export const SystemMetricsTelemetrySchema = z.object({
  activeLiffSessions: z.number().int().nonnegative(),
  canvasAvgRamMb: z.number().max(30.0),
  redisCacheHitRatio: z.number().min(0.9),
  slipVerificationP99Ms: z.number().max(800),
  cloudEgressCostThb: z.literal(0),
});
export type SystemMetricsTelemetry = z.infer<typeof SystemMetricsTelemetrySchema>;

/** BDD-1: edge DNS cutover ceiling (100ms blue->green). */
export const DNS_CUTOVER_BUDGET_MS = 100;
/** BDD-2: entitlement + Flex receipt ceiling (0.8s). */
export const SLIP_VERIFY_BUDGET_MS = 800;
/** §2.1: tenant hydration ceiling (15ms, zero CLS). */
export const TENANT_HYDRATION_BUDGET_MS = 15;
/** §2.2: degraded-mode tripwire (800ms API or 80% Redis). */
export const DEGRADED_API_BUDGET_MS = 800;
export const DEGRADED_REDIS_LOAD_PCT = 80;
/** §10.1 k6 gates: 50k VUs, 99.99% success, chunk P99 120ms. */
export const K6_TARGET_VUS = 50000;
export const K6_SUCCESS_RATE_FLOOR = 0.9999;
export const K6_CHUNK_P99_BUDGET_MS = 120;
export const K6_SLIP_P95_BUDGET_MS = 750;
/** §10.2 self-healing tripwires: RAM 28MB, slip queue 1000ms, pool 85%. */
export const HEAL_RAM_TRIP_MB = 28;
export const HEAL_SLIP_QUEUE_TRIP_MS = 1000;
export const HEAL_POOL_TRIP_PCT = 85;
/** §5.1 rollout: HPA 10-50 pods, release-tag convention. */
export const HPA_MIN_PODS = 10;
export const HPA_MAX_PODS = 50;
export const RELEASE_TAG_PREFIX = 'app:v1.130.0-';

/** The nine gatekeeper keys (§11, fixed order for reports). */
export const GATEKEEPER_KEYS = [
  'schemaSync',
  'typeSafety',
  'liffRamCheck',
  'zeroEgressCheck',
  'slipVerifyLatencyMs',
  'securityPenTestPassed',
] as const;
export type GatekeeperKey = (typeof GATEKEEPER_KEYS)[number];

/** True when every boolean gate passes and latency is within 1s. */
export function gatekeepersPass(gates: {
  schemaSync: boolean;
  typeSafety: boolean;
  liffRamCheck: boolean;
  zeroEgressCheck: boolean;
  slipVerifyLatencyMs: number;
  securityPenTestPassed: boolean;
}): boolean {
  return (
    gates.schemaSync &&
    gates.typeSafety &&
    gates.liffRamCheck &&
    gates.zeroEgressCheck &&
    gates.slipVerifyLatencyMs <= 1000 &&
    gates.securityPenTestPassed
  );
}

/** 100-or-nothing overall score (§3.1 overallScore min/max 100). */
export function overallScoreFor(pass: boolean): number {
  return pass ? 100 : 0;
}

/** True when live telemetry meets every §3.1 ceiling. */
export function telemetryPass(m: SystemMetricsTelemetry): boolean {
  return (
    m.canvasAvgRamMb <= 30.0 &&
    m.redisCacheHitRatio >= 0.9 &&
    m.slipVerificationP99Ms <= 800 &&
    m.cloudEgressCostThb === 0
  );
}

/** Production state from live signals (§2.2 matrix). */
export function productionState(input: {
  dbReachable: boolean;
  apiP95Ms: number;
  redisLoadPct: number;
  paymentUpstreamUp: boolean;
}): ProductionHealthStatus {
  if (!input.dbReachable) return 'CRITICAL_FAILURE';
  if (!input.paymentUpstreamUp) return 'MAINTENANCE';
  if (input.apiP95Ms > DEGRADED_API_BUDGET_MS || input.redisLoadPct > DEGRADED_REDIS_LOAD_PCT) {
    return 'DEGRADED';
  }
  return 'HEALTHY';
}

/** Release-tag gate (§9.1 immutable artifacts). */
export function isReleaseTag(tag: string): boolean {
  return tag.startsWith(RELEASE_TAG_PREFIX) && tag.length > RELEASE_TAG_PREFIX.length;
}

/** Go-live report cache key (per deployment). */
export function goLiveReportKey(deploymentId: string): string {
  return `golive:report:{${deploymentId}}`;
}
