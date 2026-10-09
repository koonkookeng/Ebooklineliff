// SSOT Phase 099 §3.1 — ultra-low latency live Zod domain contract
// Canonical: packages/shared/src/schemas/live-contract.ts
// (shared with 101 — 099 owns the §3.1 surface: vendor/status/access/
// chat/poll-vote; 101 extends with classroom vocabulary when it lands)
// - Spec-verbatim: LiveStreamVendorEnum / LiveSessionStatusEnum /
//   LiveStreamAccessRequestSchema / LiveStreamAccessPayloadSchema /
//   LiveChatMessagePayloadSchema / LivePollVoteSchema (§3.1).
// - RISK_CALL (§5.2 deviation): no aws-sdk/socket.io — playback rides
//   native video + HMAC short-lived tokens; chat rides SSE+REST.
// - Pure helpers: token/watermark/chat-window/VOD keys. Zod only.
import { z } from 'zod';

export const LiveStreamVendorEnum = z.enum(['WEBRTC_NATIVE', 'AMAZON_IVS', 'CLOUDFLARE_STREAM_LIVE', 'HLS_LOW_LATENCY']);
export type LiveStreamVendor = z.infer<typeof LiveStreamVendorEnum>;

export const LiveSessionStatusEnum = z.enum(['SCHEDULED', 'STARTING', 'LIVE', 'PAUSED', 'ENDED', 'ARCHIVED']);
export type LiveSessionStatus = z.infer<typeof LiveSessionStatusEnum>;

export const LiveStreamAccessRequestSchema = z.object({
  sessionId: z.string().uuid(),
  lineUserId: z.string().min(1),
  tenantId: z.string().min(1),
});
export type LiveStreamAccessRequest = z.infer<typeof LiveStreamAccessRequestSchema>;

export const LiveStreamAccessPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  vendor: LiveStreamVendorEnum,
  playbackUrl: z.string().url(),
  playbackToken: z.string().optional(),
  webrtcSdpAnswer: z.string().optional(),
  watermarkData: z.object({
    text: z.string(),
    userIdHash: z.string(),
    timestamp: z.string(),
  }),
  expiresAt: z.string(),
});
export type LiveStreamAccessPayload = z.infer<typeof LiveStreamAccessPayloadSchema>;

export const LiveChatMessagePayloadSchema = z.object({
  sessionId: z.string().uuid(),
  messageId: z.string().uuid(),
  senderName: z.string(),
  senderAvatar: z.string().url().optional(),
  content: z.string().max(500),
  isPinned: z.boolean().default(false),
  timestamp: z.string(),
});
export type LiveChatMessagePayload = z.infer<typeof LiveChatMessagePayloadSchema>;

export const LivePollVoteSchema = z.object({
  pollId: z.string().uuid(),
  optionId: z.string().uuid(),
  userId: z.string().uuid(),
});
export type LivePollVote = z.infer<typeof LivePollVoteSchema>;

/** Playback token TTL: 5 minutes, LINE-user-bound (Gate 4/§8.2). */
export const LIVE_PLAYBACK_TOKEN_TTL_SEC = 300;

/** Entitlement gate budget: 50ms (BDD-1 Gate 7). */
export const LIVE_GATE_BUDGET_MS = 50;

/** Target glass-to-glass latency ceiling: 1.5s (BDD-1). */
export const LIVE_LATENCY_CEILING_MS = 1500;

/** Chat virtualized window cap: 50 items (BDD-2 <30MB RAM). */
export const LIVE_CHAT_WINDOW = 50;

/** Live analytics event stream (Gate 8: QoS + viewers + chat). */
export const LIVE_STREAM = 'stream:live:events';

/** HMAC-bound playback token: b64(sessionId.userId.exp).sig. */
export function liveTokenBody(sessionId: string, userId: string, expSec: number): string {
  return `${sessionId}.${userId}.${expSec}`;
}

/** Redis key for the short-lived playback grant (server truth). */
export function liveGrantKey(sessionId: string, userId: string): string {
  return `live:grant:${sessionId}:${userId}`;
}

/** Redis stream key for a session chatroom (SSE fan-out). */
export function liveChatStreamKey(sessionId: string): string {
  return `stream:live:chat:${sessionId}`;
}

/** 12-hex forensic user hash for the watermark overlay (BDD-1). */
export function liveUserHash(userId: string, salt: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const s = `${salt}:${userId}`;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i), 31) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`.slice(0, 12);
}

/** R2 zero-egress VOD object prefix for a finished session (BDD-3). */
export function liveVodPrefix(sessionId: string): string {
  return `live-vod/${sessionId}/hls/master.m3u8`;
}

/** Sliding chat window: keep the newest N messages (BDD-2 RAM guard). */
export function liveChatWindow<T>(items: T[], cap: number = LIVE_CHAT_WINDOW): T[] {
  return items.length > cap ? items.slice(items.length - cap) : items;
}
