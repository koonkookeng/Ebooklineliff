// SSOT Phase 053 §3.1 — HLS token ingestion DTOs (Zod-derived, no duplicated shapes)
// Canonical: apps/backend/src/modules/stream/dto/hls-token.dto.ts
// (legacy src/backend/modules/stream/dto/hls-token.dto.ts)
// - Decorator-free on purpose: pure helpers stay tsx-importable for contract
//   tests (Phase 027–053 precedent); the controller file carries Nest param
//   decorators and is verified via static parity.
import {
  GenerateHlsTokenInputSchema,
  HlsStreamResponseSchema,
  HlsTokenPayloadSchema,
  type GenerateHlsTokenInput,
  type HlsStreamResponse,
  type HlsTokenPayload,
} from '@repo/shared';

export { GenerateHlsTokenInputSchema, HlsStreamResponseSchema, HlsTokenPayloadSchema };
export type { GenerateHlsTokenInput, HlsStreamResponse, HlsTokenPayload };

/** Client IP behind Cloudflare / proxies (CF-Connecting-IP wins, §8.1). */
export function resolveClientIp(headers: Record<string, string | string[] | undefined>, socketIp = ''): string {
  const pick = (v: string | string[] | undefined): string =>
    Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
  const cf = pick(headers['cf-connecting-ip']);
  if (cf) return cf.split(',')[0].trim();
  const fwd = pick(headers['x-forwarded-for']);
  if (fwd) return fwd.split(',')[0].trim();
  return pick(headers['x-real-ip']) || socketIp || 'unknown';
}
