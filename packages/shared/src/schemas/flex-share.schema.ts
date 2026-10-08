// SSOT Phase 080 §3.1 — Creator & affiliate one-click LINE Flex share contract
// Canonical: packages/shared/src/schemas/flex-share.schema.ts
// (legacy src/shared/schemas/flex-share.schema.ts)
// - Spec-verbatim: FlexTargetTypeEnum / FlexShareInputSchema /
//   FlexSharePayloadSchema / TrackClickPayloadSchema (§3.1).
// - RISK_CALL deviations (additive-only, documented):
//   (a) AffiliateShareMetricsSchema added for the §3.2
//       getAffiliateShareMetrics intent (spec defines the GQL payload but no
//       Zod shape — needed for the resolver gate);
//   (b) tenantId is z.string().min(1) on inputs (x-tenant-identifier slug,
//       Phase 071/073 runtime vocabulary);
//   (c) generation stays canonical in the affiliate module (079) and the
//       social-share module (026) — this contract owns tokens/metrics math
//       only, never duplicate builders (zero-redundant policy).
// - Pure helpers: HMAC-SHA256 refToken sign/verify (timing-safe, base64url,
//   30-day TTL), referral URL, CTR math, Redis key builders, 10/min
//   rate-limit budget. Zero new deps (zod only; node:crypto via require for
//   shared-package ESM safety, certificate-contract.ts precedent).
import { z } from 'zod';

export const FlexTargetTypeEnum = z.enum([
  'PRODUCT_PDP',
  'EBOOK_PREVIEW',
  'COURSE_LESSON_PREVIEW',
  'AFFILIATE_STOREFRONT',
]);
export type FlexTargetType = z.infer<typeof FlexTargetTypeEnum>;

export const FlexShareInputSchema = z.object({
  tenantId: z.string().min(1),
  productId: z.string().uuid(),
  targetType: FlexTargetTypeEnum,
  customMessage: z.string().max(100).optional(),
});
export type FlexShareInput = z.infer<typeof FlexShareInputSchema>;

export const FlexSharePayloadSchema = z.object({
  flexMessageJson: z.string(),
  referralUrl: z.string().url(),
  refToken: z.string(),
  expiresAt: z.string(),
});
export type FlexSharePayload = z.infer<typeof FlexSharePayloadSchema>;

export const TrackClickPayloadSchema = z.object({
  success: z.boolean(),
  affiliateCode: z.string(),
  isNewSession: z.boolean(),
});
export type TrackClickPayload = z.infer<typeof TrackClickPayloadSchema>;

/** §3.2 AffiliateMetricsPayload intent (Zod gate for the metrics resolver). */
export const AffiliateShareMetricsSchema = z.object({
  totalShares: z.number().int().nonnegative(),
  totalClicks: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative(),
  estimatedEarnings: z.number().nonnegative(),
  ctrPercentage: z.number().min(0).max(100),
});
export type AffiliateShareMetrics = z.infer<typeof AffiliateShareMetricsSchema>;

/** Click attribution window: 30 days (BDD-2, Redis Edge Session TTL). */
export const FLEX_REF_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;
/** Generation rate limit: 10 calls/min per user (§8.1 anti-spam). */
export const FLEX_GENERATE_RATE_LIMIT = 10;
export const FLEX_GENERATE_RATE_WINDOW_SEC = 60;
/** Click event stream (Gate 8). */
export const FLEX_CLICK_STREAM = 'share:flex:clicks';
/** Share generation event stream (Gate 8). */
export const FLEX_SHARE_STREAM = 'share:flex:generated';
/** Fraud stream reuse for self-click blocks (BDD anti-self-referral). */
export const FLEX_FRAUD_STREAM = 'affiliate:fraud:events';
/** Default LIFF origin for referral URLs (overridable per request). */
export const FLEX_DEFAULT_ORIGIN = 'https://liff.line.me';

function nodeCrypto(): { createHmac(a: string, s: string): { update(d: string): { digest(e: string): string } }; timingSafeEqual(a: Buffer, b: Buffer): boolean } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto') as never as {
    createHmac(a: string, s: string): { update(d: string): { digest(e: string): string } };
    timingSafeEqual(a: Buffer, b: Buffer): boolean;
  };
}

/** Sign a referral token: base64url(`${userId}:${productId}:${affiliateCode}:${issuedAt}:${hmac}`). */
export function signRefToken(
  secret: string,
  args: { userId: string; productId: string; affiliateCode: string; issuedAt?: number },
): string {
  const crypto = nodeCrypto();
  const at = args.issuedAt ?? Date.now();
  const payload = `${args.userId}:${args.productId}:${args.affiliateCode}:${at}`;
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

/** Verify a referral token (timing-safe HMAC + 30-day expiry). Null when invalid/expired. */
export function verifyRefToken(
  secret: string,
  refToken: string,
  now = Date.now(),
): { userId: string; productId: string; affiliateCode: string; issuedAt: number } | null {
  try {
    const crypto = nodeCrypto();
    const raw = Buffer.from(refToken, 'base64url').toString('utf8');
    const parts = raw.split(':');
    if (parts.length !== 5) return null;
    const [userId, productId, affiliateCode, issuedRaw, hmac] = parts as [string, string, string, string, string];
    if (!userId || !productId || !affiliateCode || !issuedRaw || !hmac) return null;
    const issuedAt = Number(issuedRaw);
    if (!Number.isFinite(issuedAt) || now - issuedAt > FLEX_REF_TOKEN_TTL_SEC * 1000) return null;
    const expected = crypto.createHmac('sha256', secret).update(`${userId}:${productId}:${affiliateCode}:${issuedAt}`).digest('hex');
    const a = Buffer.from(hmac, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { userId, productId, affiliateCode, issuedAt };
  } catch {
    return null;
  }
}

/** Recipient entry URL: PDP with the signed refToken (BDD-2). */
export function flexReferralUrl(origin: string, productId: string, refToken: string): string {
  const base = origin.replace(/\/$/, '');
  return `${base}/p/${productId}?refToken=${encodeURIComponent(refToken)}`;
}

/** Click-through rate as a 0–100 percentage (1-decimal). */
export function ctrOf(totalClicks: number, totalShares: number): number {
  if (totalShares <= 0) return 0;
  return Math.round((totalClicks / totalShares) * 1000) / 10;
}

/** Redis Edge session key for a visitor↔share bind (30-day TTL). */
export function flexSessionKey(refToken: string, visitorKey: string): string {
  return `share:flex:session:${refToken}:${visitorKey}`;
}

/** Rate-limit counter key for flex generation (10/min per user). */
export function flexGenerateRateKey(userId: string): string {
  return `share:flex:gen:${userId}`;
}
