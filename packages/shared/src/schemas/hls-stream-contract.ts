// SSOT Phase 053 §3.1 — HLS dynamic signed-token contracts (segment auth core)
// Canonical: packages/shared/src/schemas/hls-stream-contract.ts
// (legacy src/shared/schemas/hls-stream-contract.ts)
// - Verbatim shapes from §3.1 (+ budgets/helpers shared by NestJS issuer,
//   Cloudflare edge gatekeeper, and the LIFF signed player).
// - Budgets: token TTL 60s, player rotation 30s, edge verify <50ms,
//   mint <10ms, LIFF buffer ≤2 segments (~4MB, RAM <30MB).
// - NOTE: string-only helpers (no node:crypto) so the edge worker and the
//   browser bundle can import this file directly.
import { z } from 'zod';

export const HlsTokenPayloadSchema = z.object({
  userId: z.string().uuid(),
  lessonId: z.string().uuid(),
  tenantId: z.string().default('default'),
  clientIpHash: z.string(),
  sessionId: z.string().uuid(),
  exp: z.number().int().positive(),
  iat: z.number().int().positive(),
});

export const GenerateHlsTokenInputSchema = z.object({
  lessonId: z.string().uuid(),
  quality: z.enum(['1080p', '720p', '480p', 'auto']).default('auto'),
});

export const HlsStreamResponseSchema = z.object({
  masterPlaylistUrl: z.string().url(),
  sessionToken: z.string(),
  expiresInSeconds: z.number().int().default(60),
  watermarkPayload: z.object({
    userIdHash: z.string(),
    displayName: z.string(),
    timestamp: z.string(),
  }),
});

export type HlsTokenPayload = z.infer<typeof HlsTokenPayloadSchema>;
export type GenerateHlsTokenInput = z.infer<typeof GenerateHlsTokenInputSchema>;
export type HlsStreamResponse = z.infer<typeof HlsStreamResponseSchema>;

// ---------- §8.1/§10 budgets + wire helpers (single source) ----------
export const HLS_SEGMENT_TOKEN_TTL_SEC = 60;
export const HLS_TOKEN_ROTATE_SEC = 30;
export const HLS_EDGE_VERIFY_BUDGET_MS = 50;
export const HLS_MINT_BUDGET_MS = 10;
export const HLS_MAX_BUFFER_SEGMENTS = 2;
export const HLS_CLOCK_SKEW_SEC = 5;

export const HLS_TOKEN_MISSING = 'MISSING_HLS_TOKEN';
export const HLS_TOKEN_EXPIRED = 'HLS_TOKEN_EXPIRED';
export const HLS_TOKEN_INVALID = 'INVALID_OR_EXPIRED_HLS_TOKEN';
export const HLS_SECURITY_INCIDENT = 'UNAUTHORIZED_HLS_ACCESS_ATTEMPT';

/** Canonical token body: userId:lessonId:sessionId:ipHash:exp (§5.2). */
export function hlsTokenBody(
  userId: string,
  lessonId: string,
  sessionId: string,
  ipHash: string,
  exp: number,
): string {
  return `${userId}:${lessonId}:${sessionId}:${ipHash}:${exp}`;
}

export interface ParsedHlsToken {
  userId: string;
  lessonId: string;
  sessionId: string;
  ipHash: string;
  exp: number;
  signature: string;
}

/** Split a base64url-decoded token into 6 parts; null on malformed shape. */
export function parseHlsTokenBody(decoded: string): ParsedHlsToken | null {
  const parts = decoded.split(':');
  if (parts.length !== 6) return null;
  const [userId, lessonId, sessionId, ipHash, expStr, signature] = parts;
  const exp = Number(expStr);
  if (!userId || !lessonId || !sessionId || !ipHash || !signature) return null;
  if (!Number.isInteger(exp) || exp <= 0) return null;
  return { userId, lessonId, sessionId, ipHash, exp, signature };
}

/** Expired when nowSec is past exp (+ clock-skew grace for edge/self-heal). */
export function isHlsTokenExpired(exp: number, nowSec: number = Math.floor(Date.now() / 1000)): boolean {
  return nowSec > exp + HLS_CLOCK_SKEW_SEC;
}

/** Append (or refresh) the short-lived token on a segment/playlist URL. */
export function hlsSignedSegmentUrl(baseUrl: string, token: string): string {
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}token=${token}`;
}
