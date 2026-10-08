// SSOT Phase 070 §3.1 — Cross-device sync contracts (verbatim)
// Canonical: packages/shared/src/schemas/cross-device-sync.schema.ts
// (legacy src/shared/schemas/cross-device-sync.schema.ts)
// - Verbatim shapes from §3.1: DeviceTypeEnum, ContentTypeEnum,
//   DeviceSessionSchema, CrossDeviceSyncPayloadSchema,
//   SessionHandshakeQrPayloadSchema.
// - Complements (never duplicates) Phase 057's progress-sync-contract:
//   057 owns the SSE room transport + write-back worker; 070 owns the
//   vector-clock SSOT row, the QR handshake, and the ≤2 viewport guard.
// - Budgets: transition latency <500ms; handshake TTL 120s single-use;
//   edge state TTL 30d.
// - Browser-safe: pure Zod + clock/channel/key helpers. Zero new deps.
import { z } from 'zod';

export const DeviceTypeEnum = z.enum(['LINE_LIFF_MOBILE', 'WEB_DESKTOP', 'TABLET_PWA', 'NATIVE_APP']);
export type DeviceType = z.infer<typeof DeviceTypeEnum>;

export const ContentTypeEnum = z.enum(['EBOOK_PAGE', 'COURSE_LESSON_VIDEO']);
export type CrossDeviceContentType = z.infer<typeof ContentTypeEnum>;

export const DeviceSessionSchema = z.object({
  sessionId: z.string().uuid(),
  userId: z.string().uuid(),
  deviceType: DeviceTypeEnum,
  userAgent: z.string(),
  ipAddress: z.string(),
  lastActiveAt: z.string().datetime(),
  isActive: z.boolean(),
});
export type DeviceSession = z.infer<typeof DeviceSessionSchema>;

export const CrossDeviceSyncPayloadSchema = z.object({
  userId: z.string().uuid(),
  productId: z.string().uuid(),
  contentType: ContentTypeEnum,
  contentId: z.string(),
  positionMarker: z.object({
    pageNumber: z.number().int().nonnegative().optional(),
    watchedSec: z.number().int().nonnegative().optional(),
    totalDurationSec: z.number().int().nonnegative().optional(),
    vectorClock: z.number().int(),
  }),
  sourceDevice: DeviceTypeEnum,
  timestamp: z.string().datetime(),
});
export type CrossDeviceSyncPayload = z.infer<typeof CrossDeviceSyncPayloadSchema>;

export const SessionHandshakeQrPayloadSchema = z.object({
  handshakeToken: z.string().uuid(),
  lineUserId: z.string(),
  expiresAt: z.string().datetime(),
  targetRedirectUrl: z.string().url(),
});
export type SessionHandshakeQrPayload = z.infer<typeof SessionHandshakeQrPayloadSchema>;

// ---------- §4.2 keys + §8 viewport guard + §6 latency budgets ----------
export const CROSS_DEVICE_LATENCY_MS = 500;
export const HANDSHAKE_TTL_SEC = 120;
export const SYNC_STATE_TTL_SEC = 30 * 24 * 60 * 60;
export const MAX_ACTIVE_VIEWPORTS = 2;
export const CROSS_DEVICE_EVENT = 'position_changed';
export const DEVICE_SWITCH_STREAM = 'events:device-switch';

export function crossDeviceStateKey(userId: string, productId: string): string {
  return `sync:state:${userId}:${productId}`;
}

export function crossDeviceChannel(userId: string): string {
  return `channel:cross-device:${userId}`;
}

export function handshakeRedisKey(handshakeToken: string): string {
  return `handshake:token:${handshakeToken}`;
}

/**
 * Vector-clock conflict resolution (BDD-3): incoming wins ties and
 * newer clocks; stale loses and receives server truth (resolved=true).
 */
export function resolveCrossDeviceConflict(
  incomingClock: number,
  storedClock: number,
): { accept: boolean; conflictResolved: boolean; nextClock: number } {
  if (incomingClock >= storedClock) {
    return { accept: true, conflictResolved: incomingClock > storedClock, nextClock: incomingClock + 1 };
  }
  return { accept: false, conflictResolved: true, nextClock: storedClock };
}
