// SSOT Phase 122 §3.1 — circuit breaker & idempotency contract
// Canonical: packages/shared/src/schemas/resilience-circuit.schema.ts
// (legacy src/shared/schemas/sdid-resilience-contract.ts)
// - Spec-verbatim: CircuitStateEnum / IdempotencyHeaderSchema (key 16..128,
//   requestHash 64-hex) / CircuitBreakerConfigSchema (defaults 50/10/20 /
//   15s cooldown / 3s timeout) / IdempotencyRecordSchema.
// - RISK_CALL deviations (additive-only, documented):
//   - responseBody accepts any JSON value (spec z.record(z.any()) rejects
//     arrays/primitives; cached payloads are free-form) — 121 precedent.
//   - Header key trims whitespace (gateway leniency; min/max unchanged).
// - Pure helpers: idempotency/circuit Redis key builders, TTL budgets,
//   threshold math. Zero new deps (zod only).
import { z } from 'zod';

export const CircuitStateEnum = z.enum(['CLOSED', 'OPEN', 'HALF_OPEN']);
export type CircuitState = z.infer<typeof CircuitStateEnum>;

export const IdempotencyHeaderSchema = z.object({
  idempotencyKey: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(16, 'Idempotency Key must be at least 16 chars UUID/ULID').max(128)),
  requestHash: z.string().length(64),
});
export type IdempotencyHeader = z.infer<typeof IdempotencyHeaderSchema>;

export const CircuitBreakerConfigSchema = z.object({
  serviceName: z.string().min(1),
  failureThresholdPercentage: z.number().min(1).max(100).default(50),
  minimumNumberOfCalls: z.number().int().default(10),
  slidingWindowSize: z.number().int().default(20),
  cooldownPeriodMs: z.number().int().default(15000),
  timeoutMs: z.number().int().default(3000),
});
export type CircuitBreakerConfig = z.infer<typeof CircuitBreakerConfigSchema>;

export const IdempotencyRecordSchema = z.object({
  key: z.string().min(16).max(128),
  requestHash: z.string().length(64),
  statusCode: z.number().int(),
  responseBody: z.unknown(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type IdempotencyRecord = z.infer<typeof IdempotencyRecordSchema>;

/** BDD-1: distributed lock acquisition budget (<3ms edge target). */
export const IDEMPOTENCY_LOCK_BUDGET_MS = 3;
/** Spec §5.2: lock TTL (SET NX PX 10s). */
export const IDEMPOTENCY_LOCK_TTL_MS = 10000;
/** Spec §5.2: cached response TTL (24h). */
export const IDEMPOTENCY_DATA_TTL_SEC = 86400;
/** Spec BDD-2: rolling failure window (30s). */
export const CIRCUIT_WINDOW_SEC = 30;
/** Spec BDD-2: OPEN cooldown before HALF_OPEN probe (15s). */
export const CIRCUIT_COOLDOWN_SEC = 15;
/** Spec §5.3: per-call external timeout (3s). */
export const EXTERNAL_CALL_TIMEOUT_MS = 3000;
/** Idempotency key transport header. */
export const IDEMPOTENCY_HEADER = 'x-idempotency-key';
/** Circuit transition telemetry stream. */
export const CIRCUIT_EVENT_STREAM = 'stream:circuit-breaker';

/** Redis lock key for an idempotency key. */
export function idempotencyLockKey(key: string): string {
  return `idempotency:lock:${key}`;
}

/** Redis cached-response key for an idempotency key. */
export function idempotencyDataKey(key: string): string {
  return `idempotency:data:${key}`;
}

/** Redis circuit state key for a service. */
export function circuitStateKey(serviceName: string): string {
  return `circuit:${serviceName}:state`;
}

/** Redis rolling-window failure counter key for a service. */
export function circuitFailureKey(serviceName: string): string {
  return `circuit:${serviceName}:failures`;
}

/** Redis opened-at timestamp key (stateless HALF_OPEN recovery). */
export function circuitOpenedAtKey(serviceName: string): string {
  return `circuit:${serviceName}:opened_at`;
}

/** True when the failure ratio trips the configured threshold. */
export function circuitTripped(failures: number, total: number, thresholdPct: number): boolean {
  if (total <= 0) return false;
  return (failures / total) * 100 >= thresholdPct;
}

/** Cooldown elapsed since openedAt (ms epoch). */
export function cooldownElapsed(openedAtMs: number, nowMs: number, cooldownMs: number): boolean {
  return nowMs - openedAtMs >= cooldownMs;
}
