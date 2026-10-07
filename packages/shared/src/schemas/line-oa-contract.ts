// SSOT Phase 034 §3.1 — LINE OA auto-add-friend + webhook Zod SSOT contract
// Canonical: packages/shared/src/schemas/line-oa-contract.ts
// (legacy src/shared/schemas/line-oa-contract.ts)
// - Spec-verbatim: BotPromptModeEnum / LineOAFriendshipStatusSchema /
//   LineAuthWithOAPromptInputSchema / LineWebhookEventSchema.
// - RISK_CALL deviations (documented, additive-only):
//   - userId/tenantId are z.string().min(1), not uuid: edge identity vocabulary
//     (Phase 023–033 precedent).
//   - Webhook event type widens to follow/unfollow/message-safe unknowns: LINE
//     delivers message/postback/beacon events to the same endpoint — the schema
//     accepts them and the service ignores non-friendship types (endpoint never
//     400s a genuine LINE delivery, Gate 2 reliability).
//   - Adds pure verifyLineSignature() (single HMAC source for the guard-style
//     webhook path), OA deep-link builders, and the analytics channel.
// - Zero new deps (zod + node:crypto-free pure HMAC lives backend-side;
//   this file stays edge-safe — no crypto import here).
import { z } from 'zod';

export const BotPromptModeEnum = z.enum(['NONE', 'NORMAL', 'AGGRESSIVE']);
export type BotPromptMode = z.infer<typeof BotPromptModeEnum>;

export const LineOAFriendshipStatusSchema = z.object({
  userId: z.string().min(1),
  lineUserId: z.string().min(1),
  isOAFriend: z.boolean(),
  botPromptMode: BotPromptModeEnum,
  updatedAt: z.string().datetime(),
});
export type LineOAFriendshipStatus = z.infer<typeof LineOAFriendshipStatusSchema>;

export const LineAuthWithOAPromptInputSchema = z.object({
  idToken: z.string().min(1),
  accessToken: z.string().min(1),
  tenantId: z.string().min(1),
  isOAFriend: z.boolean(),
});
export type LineAuthWithOAPromptInput = z.infer<typeof LineAuthWithOAPromptInputSchema>;

const WebhookSourceSchema = z.object({
  type: z.string(),
  userId: z.string().min(1).optional(),
  groupId: z.string().optional(),
  roomId: z.string().optional(),
});

const WebhookEventSchema = z.object({
  type: z.string(),
  mode: z.string().optional(),
  timestamp: z.number().int().optional(),
  source: WebhookSourceSchema.optional(),
  replyToken: z.string().optional(),
});

export const LineWebhookEventSchema = z.object({
  destination: z.string().min(1),
  events: z.array(WebhookEventSchema).default([]),
});
export type LineWebhookEvent = z.infer<typeof LineWebhookEventSchema>;

/** Public per-tenant OA config (no secrets — safe for the LIFF client). */
export const LineOAPublicConfigSchema = z.object({
  tenantId: z.string().min(1),
  lineOaBasicId: z.string().min(1),
  botPromptMode: BotPromptModeEnum,
});
export type LineOAPublicConfig = z.infer<typeof LineOAPublicConfigSchema>;

/** Friendship analytics channel (Gate 8: prompt/follow/unfollow funnel). */
export const OA_EVENT_CHANNEL = 'line.oa.friendship';
/** Default bot prompt (conversion target ≈100%, §1.1). */
export const OA_BOT_PROMPT_DEFAULT: BotPromptMode = 'AGGRESSIVE';
/** Local offline cache TTL for isOAFriend (24h, §2.1 OFFLINE_FIRST). */
export const OA_FRIEND_CACHE_TTL_MS = 24 * 3600 * 1000;

export function oaFriendCacheKey(tenantId: string): string {
  return `oa-friend:${tenantId}`;
}

/** LINE add-friend deep link for an OA basic ID (@brand). */
export function oaAddFriendUrl(lineOaBasicId: string): string {
  return `https://line.me/R/ti/p/${lineOaBasicId}`;
}

/** Official QR image URL for an OA basic ID. */
export function oaQrImageUrl(lineOaBasicId: string): string {
  return `https://qr-official.line.me/sid/M/${lineOaBasicId.replace('@', '')}.png`;
}
