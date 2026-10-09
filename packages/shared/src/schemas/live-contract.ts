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

/* ------------------------------------------------------------------ */
/* Atomic Phase 101 §3.1 — interactive classroom surface (additive).   */
/* RISK_CALL: LiveChatMessagePayloadSchema keeps its 099 shape         */
/* (099 tests lock it); the 101 chat/HR shapes land as new names so    */
/* neither phase drifts. Subscriptions (§3.2) ride SSE, not WS.        */
/* ------------------------------------------------------------------ */

export const LiveHandRaiseStatusEnum = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED']);
export type LiveHandRaiseStatus = z.infer<typeof LiveHandRaiseStatusEnum>;

export const LiveMessageTypeEnum = z.enum(['TEXT', 'LINE_STICKER', 'ANNOUNCEMENT', 'PRODUCT_PIN', 'SYSTEM_EVENT']);
export type LiveMessageType = z.infer<typeof LiveMessageTypeEnum>;

export const LiveInteractiveChatSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  userId: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().url().nullable(),
  messageType: LiveMessageTypeEnum,
  content: z.string().max(500),
  stickerPackageId: z.string().optional(),
  stickerId: z.string().optional(),
  timestamp: z.string().datetime(),
});
export type LiveInteractiveChat = z.infer<typeof LiveInteractiveChatSchema>;

export const LiveHandRaisePayloadSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  userId: z.string(),
  displayName: z.string(),
  status: LiveHandRaiseStatusEnum,
  queuePosition: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type LiveHandRaisePayload = z.infer<typeof LiveHandRaisePayloadSchema>;

export const LivePollOptionSchema = z.object({
  optionId: z.string().uuid(),
  text: z.string().min(1).max(200),
  voteCount: z.number().int().nonnegative(),
});
export type LivePollOption = z.infer<typeof LivePollOptionSchema>;

export const LivePollPayloadSchema = z.object({
  pollId: z.string().uuid(),
  sessionId: z.string().uuid(),
  question: z.string().min(1).max(300),
  options: z.array(LivePollOptionSchema),
  isActive: z.boolean(),
  totalVotes: z.number().int().nonnegative(),
  userVotedOptionId: z.string().uuid().nullable().optional(),
  // RISK_CALL: nullable (099 polls carry no expiry; 101 sets durationSec).
  expiresAt: z.string().datetime().nullable(),
});
export type LivePollPayload = z.infer<typeof LivePollPayloadSchema>;

/** Hand-raise FIFO queue (Redis ZSET, score = request epoch ms). */
export function liveRaiseQueueKey(sessionId: string): string {
  return `live:raise-queue:${sessionId}`;
}

/** Atomic poll counters (Redis hashes + HyperLogLog voter sets). */
export function livePollCounterKey(pollId: string): string {
  return `live:poll:votes:${pollId}`;
}

/** Voter membership set for exactly-once voting (<100ms, BDD-3). */
export function livePollVotersKey(pollId: string): string {
  return `live:poll:voters:${pollId}`;
}

/** Concurrent viewer counter (BDD-1 peak 100k). */
export function liveViewerKey(sessionId: string): string {
  return `live:viewers:${sessionId}`;
}

/** Room fan-out channel for chat/poll/raise/viewer events (SSE bridge). */
export function liveRoomChannel(sessionId: string): string {
  return `live:room:${sessionId}`;
}

/** Vote share % per option (rounded to 2dp, sums ≈ 100). */
export function pollPercentages(votes: Array<{ optionId: string; votes: number }>): Array<{ optionId: string; votes: number; percentage: number }> {
  const total = votes.reduce((a, v) => a + v.votes, 0);
  return votes.map((v) => ({
    optionId: v.optionId,
    votes: v.votes,
    percentage: total === 0 ? 0 : Math.round((v.votes / total) * 10000) / 100,
  }));
}
