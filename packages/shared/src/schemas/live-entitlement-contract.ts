// SSOT Phase 100 §3.1 — live entitlement gatekeeper Zod domain contract
// Canonical: packages/shared/src/schemas/live-entitlement-contract.ts
// - Spec-verbatim: LiveAccessStatusEnum / LiveEntitlementCheckSchema /
//   PlaybackTokenResponseSchema / HeartbeatPayloadSchema /
//   KickSessionEventSchema (§3.1).
// - RISK_CALL: HMAC-SHA256 tokens (no JWT lib); kick fan-out rides SSE+REST
//   (no WS lib); player is native video (no HLS-JS lib) — zero-dep.
// - Pure helpers: status ranking, token/edge keys, kick reason. Zod only.
import { z } from 'zod';

export const LiveAccessStatusEnum = z.enum([
  'GRANTED',
  'DENIED_NO_ENTITLEMENT',
  'DENIED_EXPIRED',
  'DENIED_CONCURRENT_LIMIT_EXCEEDED',
  'DENIED_ROOM_FULL',
]);
export type LiveAccessStatus = z.infer<typeof LiveAccessStatusEnum>;

export const LiveEntitlementCheckSchema = z.object({
  userId: z.string().uuid(),
  liveRoomId: z.string().uuid(),
  lineUserId: z.string().optional(),
  deviceFingerprint: z.string(),
  requestTimestamp: z.number().int(),
});
export type LiveEntitlementCheck = z.infer<typeof LiveEntitlementCheckSchema>;

export const PlaybackTokenResponseSchema = z.object({
  accessStatus: LiveAccessStatusEnum,
  playbackToken: z.string().nullable(),
  hlsStreamUrl: z.string().url().nullable(),
  tokenExpiresAt: z.number().int(),
  heartbeatIntervalSec: z.number().int().default(15),
  watermarkPayload: z.object({
    userIdHash: z.string(),
    displayName: z.string(),
    ipAddress: z.string(),
    timestamp: z.string(),
  }),
});
export type PlaybackTokenResponse = z.infer<typeof PlaybackTokenResponseSchema>;

export const HeartbeatPayloadSchema = z.object({
  sessionToken: z.string(),
  liveRoomId: z.string().uuid(),
  currentPlaybackSec: z.number(),
  deviceFingerprint: z.string(),
});
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;

export const KickSessionEventSchema = z.object({
  roomId: z.string().uuid(),
  userId: z.string().uuid(),
  reason: z.string(),
  actionTimestamp: z.string(),
});
export type KickSessionEvent = z.infer<typeof KickSessionEventSchema>;

/** Ephemeral playback token TTL: 30 seconds (§5.2/§8.1). */
export const LIVE_EPHEMERAL_TOKEN_TTL_SEC = 30;

/** Heartbeat cadence: 15 seconds (BDD-2). */
export const LIVE_HEARTBEAT_INTERVAL_SEC = 15;

/** Active-device TTL refresh window: 30 seconds. */
export const LIVE_DEVICE_TTL_SEC = 30;

/** Edge entitlement cache TTL: 60 seconds (§5.2). */
export const LIVE_EDGE_CACHE_TTL_SEC = 60;

/** Gate SLA: <100ms room validation (BDD-1 Gate 7). */
export const LIVE_ROOM_GATE_BUDGET_MS = 100;

/** Kick delivery SLA: <2 seconds (BDD-2). */
export const LIVE_KICK_BUDGET_MS = 2000;

/** No-JWT anonymous token-request velocity guard: 5/IP (Gate 4/§7.1). */
export const LIVE_ANON_VELOCITY_MAX = 5;

/** Kick fan-out channel (multi-instance Redis pub/sub). */
export const LIVE_KICK_CHANNEL = 'live_session_kick_channel';

/** Live gatekeeper analytics stream (Gate 8). */
export const LIVE_GATE_STREAM = 'stream:live:gatekeeper';

/** Redis edge key for a cached room entitlement verdict. */
export function liveEdgeKey(liveRoomId: string, userId: string): string {
  return `live:entitlement:${liveRoomId}:${userId}`;
}

/** Redis key binding one active device per room+user (concurrent guard). */
export function liveDeviceKey(liveRoomId: string, userId: string): string {
  return `live:active_session:${liveRoomId}:${userId}`;
}

/** SSE kick stream key for a room+user viewer. */
export function liveKickStreamKey(liveRoomId: string, userId: string): string {
  return `stream:live:kick:${liveRoomId}:${userId}`;
}

/** HMAC-bound ephemeral token body: room.user.session.exp. */
export function liveEphemeralBody(liveRoomId: string, userId: string, sessionToken: string, expSec: number): string {
  return `${liveRoomId}.${userId}.${sessionToken}.${expSec}`;
}

/** Denied ranks above granted for paywall copy selection. */
export function isGranted(status: string): boolean {
  return status === 'GRANTED';
}
