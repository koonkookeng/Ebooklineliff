// SSOT Phase 025 §3.1 — Permanent Mini App Scheme Resolver & Dynamic Deep-Linking Zod Contract
// Canonical: packages/shared/src/schemas/resolver-contract.ts
// (legacy src/shared/schemas/resolver-contract.ts)
// - Spec §3.1 verbatim enums + ResolvedState / CreateShortLinkInput.
// - RISK_CALL deviations (documented, additive-only):
//   - tenantId is z.string().min(1) (opaque slug 'default'), not uuid: subdomain hints
//     and Tenant.slug flow as strings at the edge (Phase 023/024 precedent).
//   - targetId is z.string().min(1), not uuid: Product ids are uuids in prod but
//     dev/seed flows use short ids; uuid strictness would 400 valid internal links.
//   - affiliateCode/campaignId/couponCode accept min(1) strings (codes like 'AFF999',
//     'HB-SALE-2026'), not uuid.
//   - customPath must start with '/' and contain no '..' (traversal guard).
// - Zero new deps (zod only). Edge-safe pure helpers (no node:crypto here).
import { z } from 'zod';

export const EnvironmentTypeEnum = z.enum([
  'LINE_IOS',
  'LINE_ANDROID',
  'EXTERNAL_MOBILE_IOS',
  'EXTERNAL_MOBILE_ANDROID',
  'DESKTOP_WEB',
]);
export type EnvironmentType = z.infer<typeof EnvironmentTypeEnum>;

export const DeepLinkTargetTypeEnum = z.enum([
  'EBOOK',
  'ELEARNING_COURSE',
  'PHYSICAL_PRODUCT',
  'HYBRID_BUNDLE',
  'PROMOTION_CAMPAIGN',
  'AFFILIATE_DISCOVERY',
]);
export type DeepLinkTargetType = z.infer<typeof DeepLinkTargetTypeEnum>;

export const ResolvedStateSchema = z.object({
  targetType: DeepLinkTargetTypeEnum,
  targetId: z.string().min(1),
  tenantId: z.string().min(1),
  affiliateCode: z.string().min(1).optional(),
  campaignId: z.string().min(1).optional(),
  couponCode: z.string().min(1).optional(),
  customPath: z
    .string()
    .startsWith('/')
    .refine((p) => !p.includes('..'), { message: 'Path traversal blocked' }),
  signature: z.string().min(64), // HMAC-SHA256 hex
});
export type ResolvedState = z.infer<typeof ResolvedStateSchema>;

export const CreateShortLinkInputSchema = z.object({
  tenantId: z.string().min(1),
  targetType: DeepLinkTargetTypeEnum,
  targetId: z.string().min(1),
  customSlug: z
    .string()
    .max(50)
    .regex(/^[A-Za-z0-9-_]+$/, { message: 'Slug must be URL-safe [A-Za-z0-9-_]' })
    .optional(),
  affiliateCode: z.string().min(1).max(64).optional(),
  campaignId: z.string().min(1).max(64).optional(),
  couponCode: z.string().min(1).max(64).optional(),
  expiresAt: z.string().datetime().optional(),
  maxRedemptions: z.number().int().positive().optional(),
});
export type CreateShortLinkInput = z.infer<typeof CreateShortLinkInputSchema>;

export const ShortCodeParamSchema = z.object({
  shortCode: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[A-Za-z0-9-_]+$/, { message: 'Invalid short code' }),
});
export type ShortCodeParam = z.infer<typeof ShortCodeParamSchema>;

export const ResolveShortCodeResponseSchema = z.object({
  success: z.literal(true),
  targetUrl: z.string().startsWith('/'),
  tenantId: z.string().min(1),
  targetType: DeepLinkTargetTypeEnum,
  targetId: z.string().min(1),
  affiliateCode: z.string().optional(),
  couponCode: z.string().optional(),
  customPath: z.string().startsWith('/'),
  requiresAuth: z.boolean(),
});
export type ResolveShortCodeResponse = z.infer<typeof ResolveShortCodeResponseSchema>;

/** BDD §1.3: UA classifier — pure, edge-safe (used by middleware + backend). */
export function detectEnvironment(userAgent: string): EnvironmentType {
  const ua = userAgent ?? '';
  const isLine = /Line/i.test(ua);
  if (isLine) return /iPhone|iPad|iPod/i.test(ua) ? 'LINE_IOS' : 'LINE_ANDROID';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'EXTERNAL_MOBILE_IOS';
  if (/Android/i.test(ua)) return 'EXTERNAL_MOBILE_ANDROID';
  return 'DESKTOP_WEB';
}

/** Target type → default LIFF path fallback (when customPath absent). */
export function defaultTargetPath(targetType: DeepLinkTargetType, targetId: string): string {
  switch (targetType) {
    case 'EBOOK':
      return `/ebook/${targetId}`;
    case 'ELEARNING_COURSE':
      return `/course/${targetId}`;
    case 'PHYSICAL_PRODUCT':
      return `/product/${targetId}`;
    case 'HYBRID_BUNDLE':
      return `/bundle/${targetId}`;
    case 'PROMOTION_CAMPAIGN':
      return `/promo/${targetId}`;
    case 'AFFILIATE_DISCOVERY':
      return `/discover/${targetId}`;
    default:
      return '/store';
  }
}

/** Parse a raw `liff.state` value into a safe path (never throws). */
export function parseLiffStateToPath(liffState: string | null | undefined): string {
  if (!liffState) return '/store';
  try {
    const decoded = decodeURIComponent(liffState);
    if (!decoded.startsWith('/')) return `/${decoded.replace(/^\/+/, '')}`;
    if (decoded.includes('..')) return '/store';
    return decoded;
  } catch {
    return '/store';
  }
}

/** Resolver latency budget guard (§10.1: < 300ms). */
export const RESOLVER_LATENCY_BUDGET_MS = 300;
/** External-browser native-app handoff window (§1.3: 1.5s fallback). */
export const NATIVE_HANDOFF_TIMEOUT_MS = 1500;
/** Per-IP rate limit (§8.1: 100 req/min). */
export const RESOLVER_RATE_LIMIT_PER_MIN = 100;
