// SSOT Phase 050 §3.1 — HLS video segment rate-limit + anti-scraping contracts
// Canonical: packages/shared/src/schemas/video-security.schema.ts
// (legacy src/shared/schemas/video-security.schema.ts)
// - Zod is the Single Source of Truth; Nest DTOs + controller validation derive from here.
// - Budgets: WINDOW 2s / MAX_BURST 5 segs / SCRAPE burst >8 per 1s → 429 / token TTL 10s / key rotation 10s.
import { z } from 'zod';

export const StreamTokenTypeEnum = z.enum(['MANIFEST_ACCESS', 'SEGMENT_FETCH', 'KEY_DECRYPTION']);
export type StreamTokenType = z.infer<typeof StreamTokenTypeEnum>;

export const HlsStreamTokenRequestSchema = z.object({
  lessonId: z.string().uuid(),
  userId: z.string().uuid(),
  lineUserId: z.string().optional(),
  deviceFingerprint: z.string().min(16),
  ipAddress: z.string().ip(),
});
export type HlsStreamTokenRequest = z.infer<typeof HlsStreamTokenRequestSchema>;

export const HlsStreamTokenPayloadSchema = z.object({
  streamToken: z.string(),
  expiresAt: z.number().int().positive(),
  keyRotationIntervalSec: z.number().int().default(10),
  playbackSessionId: z.string().uuid(),
});
export type HlsStreamTokenPayload = z.infer<typeof HlsStreamTokenPayloadSchema>;

export const VideoSegmentRequestSchema = z.object({
  lessonId: z.string().uuid(),
  segmentName: z.string().regex(/^[a-zA-Z0-9_\-]+\.(ts|m4s)$/),
  token: z.string(),
  clientTimestamp: z.number().int(),
});
export type VideoSegmentRequest = z.infer<typeof VideoSegmentRequestSchema>;

export const AntiScrapingViolationLogSchema = z.object({
  userId: z.string().uuid(),
  lessonId: z.string().uuid(),
  ipAddress: z.string().ip(),
  requestCountPerSec: z.number().int(),
  actionTaken: z.enum(['WARNING_THROTTLE', 'TEMPORARY_BLOCK', 'PERMANENT_BAN']),
  userAgent: z.string(),
});
export type AntiScrapingViolationLog = z.infer<typeof AntiScrapingViolationLogSchema>;

// ---------- §5.2/§8.1 budgets + key helpers (single source; backend + edge share these) ----------
export const VIDEO_RATE_WINDOW_SEC = 2;
export const VIDEO_RATE_MAX_BURST_SEGMENTS = 5;
export const VIDEO_SCRAPE_BURST_PER_SEC = 8;
export const VIDEO_SCRAPE_RISK_BAN_THRESHOLD = 100;
export const VIDEO_SCRAPE_RISK_WINDOW_SEC = 300;
export const VIDEO_SCRAPE_TEMP_BLOCK_SEC = 1800;
export const VIDEO_TOKEN_TTL_SEC = 10;
export const VIDEO_KEY_ROTATION_SEC = 10;
export const VIDEO_TOKEN_RENEW_SEC = 8;
export const VIDEO_PLAYER_MAX_BUFFER_SEC = 10;
export const VIDEO_PLAYER_MAX_MAX_BUFFER_SEC = 20;
export const VIDEO_429_RETRY_BASE_MS = 3000;

export function videoRateLimitKey(userId: string, lessonId: string): string {
  return `rate_limit:video_segment:${userId}:${lessonId}`;
}

export function videoHeartbeatKey(userId: string, lessonId: string): string {
  return `video:heartbeat:${userId}:${lessonId}`;
}

export function videoRiskScoreKey(userId: string): string {
  return `video:risk:${userId}`;
}

export function videoRequestStreamKey(): string {
  return 'stream:video:requests';
}

export function videoSessionKey(sessionToken: string): string {
  return `video:session:${sessionToken}`;
}

/** Exponential backoff for HTTP 429 resume (3s, 6s, 12s … capped at 30s). */
export function videoBackoffMs(attempt: number): number {
  return Math.min(VIDEO_429_RETRY_BASE_MS * 2 ** Math.max(0, attempt), 30000);
}

/** Non-sequential fetch heuristic: parallel/out-of-order segment pulls signal a ripper bot. */
export function isNonSequentialFetch(requestedIndex: number, expectedNextIndex: number): boolean {
  return requestedIndex !== expectedNextIndex && requestedIndex !== expectedNextIndex + 1;
}
