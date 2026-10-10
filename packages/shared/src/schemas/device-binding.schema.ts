// SSOT Phase 119 §3.1 — device binding & stream session contract
// Canonical: packages/shared/src/schemas/device-binding.schema.ts
// - Spec-verbatim: DeviceTypeEnum (4 LIFF/web values) / SessionStatusEnum /
//   DeviceFingerprintPayloadSchema (64-hex lanes) /
//   StreamHeartbeatPayloadSchema / SessionEvictionResponseSchema.
// - RISK_CALL deviations (additive-only, documented):
//   - lessonId/sessionToken accept min(1) edge vocabulary in addition to
//     uuid (023-031 precedent); screenResolution/userAgent min(1) (spec
//     leaves them unconstrained).
//   - Prisma DeviceType is the 7-value union (070 rows predate 119);
//     the Zod 4-value enum is the 119 wire vocabulary.
// - Pure helpers: activeStreamKey, deviceLimit, fraudScore (§7.1 weights:
//   teleport +40, device-swap signals), eviction classification, budgets
//   (150ms evict, 10s stale, 15s TTL, 5s heartbeat, 2-device cap,
//   5-devices/hour + score>85 lock).
// - Zero new deps (zod only).
import { z } from 'zod';

// NOTE: `DeviceTypeEnum`/`DeviceType` are owned by cross-device-sync.schema
// (070); the 119 wire vocabulary exports `BoundDeviceTypeEnum` (same four
// spec values) to avoid a barrel collision (081/111/114 precedent).
export const BoundDeviceTypeEnum = z.enum([
  'LINE_LIFF_IOS',
  'LINE_LIFF_ANDROID',
  'WEB_DESKTOP',
  'WEB_MOBILE_BROWSER',
]);
export type BoundDeviceType = z.infer<typeof BoundDeviceTypeEnum>;

export const SessionStatusEnum = z.enum([
  'ACTIVE_STREAMING',
  'IDLE',
  'EVICTED_CONCURRENT',
  'BLOCKED_FRAUD',
]);
export type SessionStatus = z.infer<typeof SessionStatusEnum>;

const HEX64 = z.string().length(64, 'fingerprint lanes must be 64-char SHA-256 hex');

export const DeviceFingerprintPayloadSchema = z.object({
  canvasHash: HEX64,
  webglHash: HEX64,
  audioHash: HEX64,
  screenResolution: z.string().min(1),
  userAgent: z.string().min(1),
  lineUserIdHash: z.string().optional(),
  deviceType: BoundDeviceTypeEnum,
});
export type DeviceFingerprintPayload = z.infer<typeof DeviceFingerprintPayloadSchema>;

export const StreamHeartbeatPayloadSchema = z.object({
  lessonId: z.string().min(1),
  sessionToken: z.string().min(1),
  fingerprintHash: z.string().length(64),
  playbackPositionSec: z.number().int().nonnegative(),
});
export type StreamHeartbeatPayload = z.infer<typeof StreamHeartbeatPayloadSchema>;

export const SessionEvictionResponseSchema = z.object({
  isEvicted: z.boolean(),
  activeDeviceId: z.string().optional(),
  reason: z.string(),
  timestamp: z.string(),
});
export type SessionEvictionResponse = z.infer<typeof SessionEvictionResponseSchema>;

/** 119 §1.3 BDD: eviction signal lands within 150ms. */
export const EVICTION_SLA_MS = 150;
/** 119 §5.2: streams stale after 10s without heartbeat. */
export const STREAM_STALE_MS = 10_000;
/** Redis active-stream hash TTL: 15s (spec §5.2). */
export const STREAM_HASH_TTL_SEC = 15;
/** LIFF heartbeat cadence: every 5s (spec §2.2). */
export const HEARTBEAT_CADENCE_SEC = 5;
/** Plan cap: max 2 trusted devices (BDD-1). */
export const DEVICE_PLAN_LIMIT = 2;
/** BDD-3: 5 distinct fingerprints/hour trips the fraud screen. */
export const FRAUD_DEVICE_WINDOW_COUNT = 5;
export const FRAUD_WINDOW_MS = 60 * 60 * 1000;
/** BDD-3: fraud score above 85 locks the account. */
export const FRAUD_LOCK_SCORE = 85;
/** §7.1 weight: >500km in 5min adds 40 points. */
export const FRAUD_TELEPORT_WEIGHT = 40;
/** §7.1 weight: >3 unique devices in 24h raises the alert. */
export const FRAUD_SWAP_DEVICE_COUNT = 3;
/** Network-flap grace: 2 missed beats (10s) before evict (§10). */
export const HEARTBEAT_GRACE_MISSES = 2;
/** Device security event stream (Gate 8). */
export const DEVICE_EVENT_STREAM = 'stream:device:events';

/** Redis hash holding one user's live stream pointer. */
export function activeStreamKey(userId: string): string {
  return `active_stream:${userId}`;
}

export function deviceSessionKey(userId: string, fingerprintHash: string): string {
  return `device:session:${userId}:${fingerprintHash.slice(0, 16)}`;
}

/** Within plan cap (Max 2 devices, BDD-1). */
export function withinDeviceLimit(registeredCount: number, limit = DEVICE_PLAN_LIMIT): boolean {
  return registeredCount < limit;
}

/** Stale when the last beat is older than the 10s threshold. */
export function isStreamStale(lastHeartbeatMs: number, nowMs: number, thresholdMs = STREAM_STALE_MS): boolean {
  return nowMs - lastHeartbeatMs >= thresholdMs;
}

export interface FraudSignals {
  teleportKm: number;
  teleportMinutes: number;
  uniqueDevices24h: number;
  distinctFingerprints1h: number;
}

/**
 * §7.1 fraud score (0–100, clamped): teleport>500km/5min → +40;
 * >3 devices/24h → +30; ≥5 fingerprints/hour → +35.
 */
export function fraudScore(signals: FraudSignals): number {
  let score = 0;
  if (signals.teleportKm > 500 && signals.teleportMinutes <= 5) score += FRAUD_TELEPORT_WEIGHT;
  if (signals.uniqueDevices24h > FRAUD_SWAP_DEVICE_COUNT) score += 30;
  if (signals.distinctFingerprints1h >= FRAUD_DEVICE_WINDOW_COUNT) score += 35;
  return Math.min(100, score);
}

/** Account lock verdict for BDD-3. */
export function fraudLockVerdict(score: number): 'ALLOW' | 'LOCK' {
  return score > FRAUD_LOCK_SCORE ? 'LOCK' : 'ALLOW';
}
