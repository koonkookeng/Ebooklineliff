// SSOT Phase 069 §3.1 — Network status + offline queue contracts (verbatim)
// Canonical: packages/shared/src/schemas/network-status.schema.ts
// (legacy src/shared/schemas/network-status.schema.ts)
// - Verbatim shapes from §3.1: NetworkQualityEnum, NetworkStatusStateEnum,
//   OfflineQueueActionTypeEnum, NetworkStatusPayloadSchema,
//   OfflineQueueItemSchema, HealthPingResponseSchema.
// - Budgets: ping timeout 2000ms; degraded >1500ms; stable <300ms; ping
//   cadence 10s; online toast 2.5s; payloads <100 bytes (zero egress).
// - Tamper-evidence: queueItemIntegrity (SHA-256 canonical) replaces the
//   idb-package sample with a native, dependency-free equivalent.
// - Browser-safe: pure Zod + state/budget/integrity helpers. Zero new deps.
import { z } from 'zod';

export const NetworkQualityEnum = z.enum([
  'EXCELLENT',
  'GOOD',
  'DEGRADED',
  'DISCONNECTED',
]);
export type NetworkQuality = z.infer<typeof NetworkQualityEnum>;

export const NetworkStatusStateEnum = z.enum([
  'ONLINE_STABLE',
  'NETWORK_DEGRADED',
  'OFFLINE_DISCONNECTED',
  'RECONNECTING_PING',
  'SYNCING_OFFLINE_QUEUE',
]);
export type NetworkStatusState = z.infer<typeof NetworkStatusStateEnum>;

export const OfflineQueueActionTypeEnum = z.enum([
  'SYNC_EBOOK_PROGRESS',
  'SYNC_LESSON_PROGRESS',
  'SUBMIT_QUIZ_ANSWER',
  'TOGGLE_BOOKMARK',
]);
export type OfflineQueueActionType = z.infer<typeof OfflineQueueActionTypeEnum>;

export const NetworkStatusPayloadSchema = z.object({
  isOnline: z.boolean(),
  latencyMs: z.number().nonnegative(),
  effectiveType: z.enum(['4g', '3g', '2g', 'slow-2g', 'unknown']),
  currentState: NetworkStatusStateEnum,
  pendingQueueCount: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
});
export type NetworkStatusPayload = z.infer<typeof NetworkStatusPayloadSchema>;

export const OfflineQueueItemSchema = z.object({
  id: z.string().uuid(),
  actionType: OfflineQueueActionTypeEnum,
  payload: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  retryCount: z.number().int().default(0),
});
export type OfflineQueueItem = z.infer<typeof OfflineQueueItemSchema>;

export const HealthPingResponseSchema = z.object({
  status: z.literal('ok'),
  serverTimestamp: z.number(),
  tenantId: z.string().optional(),
});
export type HealthPingResponse = z.infer<typeof HealthPingResponseSchema>;

// ---------- §2.2/§5 budgets + state machine (single source) ----------
export const NETWORK_PING_TIMEOUT_MS = 2000;
export const NETWORK_DEGRADED_MS = 1500;
export const NETWORK_STABLE_MS = 300;
export const NETWORK_PING_CADENCE_MS = 10000;
export const ONLINE_TOAST_MS = 2500;

/** §2.2 state derivation: offline → degraded → stable. */
export function deriveNetworkState(isOnline: boolean, latencyMs: number): NetworkStatusState {
  if (!isOnline) return 'OFFLINE_DISCONNECTED';
  if (latencyMs > NETWORK_DEGRADED_MS) return 'NETWORK_DEGRADED';
  return 'ONLINE_STABLE';
}

/** Quality bucket for analytics (mirrors deriveNetworkState). */
export function networkQualityOf(isOnline: boolean, latencyMs: number): z.infer<typeof NetworkQualityEnum> {
  if (!isOnline) return 'DISCONNECTED';
  if (latencyMs > NETWORK_DEGRADED_MS) return 'DEGRADED';
  if (latencyMs > NETWORK_STABLE_MS) return 'GOOD';
  return 'EXCELLENT';
}

/**
 * Gate 4 tamper-evidence: SHA-256 over the canonical action envelope.
 * Async (WebCrypto); the service re-checks shape + ownership (JWT).
 */
export async function queueItemIntegrity(actionType: string, payloadJson: string, createdAt: string): Promise<string> {
  const bytes = new TextEncoder().encode([actionType, payloadJson, createdAt].join(':'));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
