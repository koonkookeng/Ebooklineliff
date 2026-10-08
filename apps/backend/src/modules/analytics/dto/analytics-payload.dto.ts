// SSOT Phase 052 §3.1 — ingestion DTOs (Zod-derived, no duplicated shapes)
// Canonical: apps/backend/src/modules/analytics/dto/analytics-payload.dto.ts
// (legacy src/backend/modules/analytics/dto/analytics-payload.dto.ts)
// - Decorator-free on purpose: pure helpers stay tsx-importable for contract
//   tests (Phase 027–052 precedent); the controller file carries Nest param
//   decorators and is verified via static parity.
import {
  ANALYTICS_PULSE_PER_MIN,
  AnalyticsBatchIngestSchema,
  ReadTimeTrackingPayloadSchema,
  WatchTimeTrackingPayloadSchema,
  type AnalyticsBatchIngestPayload,
  type ReadTimeTrackingPayload,
  type WatchTimeTrackingPayload,
} from '@repo/shared';

export {
  AnalyticsBatchIngestSchema,
  ReadTimeTrackingPayloadSchema,
  WatchTimeTrackingPayloadSchema,
};
export type { AnalyticsBatchIngestPayload, ReadTimeTrackingPayload, WatchTimeTrackingPayload };

/** Server-authoritative identity stamp (Gate 4: client userIds untrusted). */
export function stampAnalyticsIdentity(
  payload: AnalyticsBatchIngestPayload,
  userId: string,
): AnalyticsBatchIngestPayload {
  return {
    ...payload,
    readEvents: payload.readEvents.map((e) => ({ ...e, userId })),
    watchEvents: payload.watchEvents.map((e) => ({ ...e, userId })),
  };
}

/** Fixed-window shield verdict (§8.2: ≤30 pulses/min/user). */
export function isPulseAllowed(pulseCount: number): boolean {
  return pulseCount <= ANALYTICS_PULSE_PER_MIN;
}
