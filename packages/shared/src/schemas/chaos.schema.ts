// SSOT Phase 124 §3.1 — chaos & fault-injection contract
// Canonical: packages/shared/src/schemas/chaos.schema.ts
// (legacy src/shared/schemas/sdid-chaos-contract.ts)
// - Spec-verbatim: ChaosFaultTypeEnum (5 faults) / ChaosInjectionPayload
//   (defaults 10s/1.0) / OutboxPaymentQueueSchema (PENDING/PROCESSING/
//   FAILED/COMPLETED).
// - RISK_CALL deviations (additive-only, documented):
//   - CircuitBreakerStateEnum is NOT re-declared (122 owns CircuitStateEnum;
//     124 re-exports the name as an alias — Zero Redundant Code).
//   - orderId/slipImageUrl accept min(1) edge vocabulary (spec uuid/url
//     are the narrow cases; queue rows predate strict URLs, 023 precedent).
//   - targetService min(1) (spec leaves it unconstrained).
// - Pure helpers: fault scoping, backoff, queue keys, budgets. Zero new
//   deps (zod only).
import { z } from 'zod';
import { CircuitStateEnum as ResilienceCircuitStateEnum } from './resilience-circuit.schema';

/** 124 alias over the 122-owned circuit state vocabulary. */
export const CircuitBreakerStateEnum = ResilienceCircuitStateEnum;
export type CircuitBreakerState = z.infer<typeof CircuitBreakerStateEnum>;

export const ChaosFaultTypeEnum = z.enum([
  'REDIS_DOWN',
  'EASYSLIP_TIMEOUT',
  'EASYSLIP_500_ERROR',
  'DB_POOL_EXHAUSTION',
  'R2_STORAGE_LATENCY',
]);
export type ChaosFaultType = z.infer<typeof ChaosFaultTypeEnum>;

export const ChaosInjectionPayloadSchema = z.object({
  faultType: ChaosFaultTypeEnum,
  durationMs: z.number().int().positive().default(10000),
  failureRate: z.number().min(0).max(1).default(1.0),
  targetService: z.string().min(1),
});
export type ChaosInjectionPayload = z.infer<typeof ChaosInjectionPayloadSchema>;

export const OutboxPaymentStatusEnum = z.enum(['PENDING', 'PROCESSING', 'FAILED', 'COMPLETED']);
export type OutboxPaymentStatus = z.infer<typeof OutboxPaymentStatusEnum>;

export const OutboxPaymentQueueSchema = z.object({
  orderId: z.string().min(1),
  slipImageUrl: z.string().min(1),
  uploadedAt: z.string().datetime(),
  retryCount: z.number().int().nonnegative(),
  status: OutboxPaymentStatusEnum,
});
export type OutboxPaymentQueue = z.infer<typeof OutboxPaymentQueueSchema>;

/** BDD-1: reader fallback detection budget (50ms Redis-fault detect). */
export const CHAOS_READER_FALLBACK_MS = 50;
/** BDD-2: EasySlip chaos latency injection (5s) vs breaker timeout (1s). */
export const CHAOS_EASYSLIP_LATENCY_MS = 5000;
export const CHAOS_SLIP_TIMEOUT_MS = 1000;
/** §10.2: self-healing drain SLA (30s post-recovery). */
export const CHAOS_DRAIN_SLA_MS = 30000;
/** Outbox worker lanes: max attempts + base backoff (1s,2s,4s,8s) + cap. */
export const OUTBOX_MAX_RETRIES = 4;
export const OUTBOX_BACKOFF_BASE_MS = 1000;
export const OUTBOX_BACKOFF_CAP_MS = 8000;
/** Fault registry TTL ceiling (5 min admin drills). */
export const CHAOS_FAULT_TTL_SEC = 300;
/** §7.1 telemetry streams. */
export const CHAOS_EVENT_STREAM = 'stream:chaos-faults';
export const OUTBOX_EVENT_STREAM = 'stream:payment-outbox';
/** Thai queued-slip copy (BDD-2 fallback UI). */
export const SLIP_QUEUED_MESSAGE =
  'สลิปของคุณถูกบันทึกเข้าคิวตรวจสอบเรียบร้อยแล้ว ระบบจะอนุมัติสิทธิ์ให้ทันทีภายใน 1 นาที';

/** Active-fault registry key per service. */
export function chaosFaultKey(serviceName: string): string {
  return `chaos:fault:${serviceName}`;
}

/** Outbox row lock key (single worker claim). */
export function outboxClaimKey(orderId: string): string {
  return `outbox:claim:${orderId}`;
}

/** Jittered exponential backoff (1s,2s,4s,8s cap; ±20% jitter). */
export function outboxBackoffMs(retryCount: number): number {
  const exp = Math.min(OUTBOX_BACKOFF_CAP_MS, OUTBOX_BACKOFF_BASE_MS * 2 ** Math.max(0, retryCount));
  const jitter = exp * 0.2 * (Math.random() * 2 - 1);
  return Math.round(exp + jitter);
}

/** Deterministic fault sampling (failureRate gate, injectable random). */
export function shouldInjectFault(failureRate: number, sample: number): boolean {
  if (failureRate >= 1) return true;
  if (failureRate <= 0) return false;
  return sample < failureRate;
}

/** True when a fault row is live (active + unexpired). */
export function faultIsLive(active: boolean, startedAtMs: number, durationMs: number, nowMs: number): boolean {
  return active && nowMs - startedAtMs < durationMs;
}
