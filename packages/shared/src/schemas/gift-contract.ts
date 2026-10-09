// SSOT Phase 089 §3.1 — Mini App Gift Center contract
// Canonical: packages/shared/src/schemas/gift-contract.ts
// (legacy src/shared/schemas/gift-contract.ts — placeholder until now)
// - Spec-verbatim: GiftStatusEnum / GreetingThemeEnum /
//   CreateGiftOrderInputSchema / ClaimGiftPayloadSchema /
//   GiftDetailResponseSchema (§3.1).
// - RISK_CALL (documented): orderId is nullable at creation (gift precedes
//   payment; bound at sender checkout — payment core untouched). claimCode
//   is human-readable GIFT-<base36>-<rand4> (nicer than uuid for Flex +
//   typing), still @unique. Expiry default 30 days (§1.1 policy).
// - Pure helpers: claim-code gen, expiry math, claim-window guard,
//   K-factor, deep-link builder, stream keys. Zero new deps (zod only).
import { z } from 'zod';

export const GiftStatusEnum = z.enum([
  'PENDING_PAYMENT',
  'READY_TO_CLAIM',
  'CLAIMED',
  'EXPIRED_REVERTED',
  'CANCELLED_REFUNDED',
]);
export type GiftStatus = z.infer<typeof GiftStatusEnum>;

export const GreetingThemeEnum = z.enum([
  'BIRTHDAY_CELEBRATION',
  'NEW_YEAR_GOALS',
  'CONGRATULATIONS',
  'THANK_YOU',
  'CUSTOM_BRANDED',
]);
export type GreetingTheme = z.infer<typeof GreetingThemeEnum>;

export const CreateGiftOrderInputSchema = z.object({
  tenantId: z.string().min(1).optional(),
  productId: z.string().uuid(),
  greetingTheme: GreetingThemeEnum,
  greetingMessage: z.string().min(1).max(500),
  senderDisplayName: z.string().min(1).max(100),
  isAnonymous: z.boolean().default(false),
  expiryDays: z.number().int().min(1).max(90).default(30),
});
export type CreateGiftOrderInput = z.infer<typeof CreateGiftOrderInputSchema>;

export const ClaimGiftPayloadSchema = z.object({
  claimCode: z.string().min(8).max(64),
});
export type ClaimGiftPayload = z.infer<typeof ClaimGiftPayloadSchema>;

export const GiftDetailResponseSchema = z.object({
  giftId: z.string().uuid(),
  claimCode: z.string(),
  status: GiftStatusEnum,
  productTitle: z.string(),
  productCoverUrl: z.string().url(),
  productType: z.enum(['PHYSICAL_BOOK', 'EBOOK', 'ELEARNING_COURSE', 'HYBRID_BUNDLE']),
  senderName: z.string(),
  greetingTheme: GreetingThemeEnum,
  greetingMessage: z.string(),
  expiresAt: z.string().datetime(),
  claimedAt: z.string().datetime().nullable(),
  recipientName: z.string().nullable(),
});
export type GiftDetailResponse = z.infer<typeof GiftDetailResponseSchema>;

/** Default expiry policy: 30 days (BDD-3). */
export const GIFT_DEFAULT_EXPIRY_DAYS = 30;
/** Gift event stream (Gate 8, K-factor pipeline). */
export const GIFT_STREAM = 'stream:gift:events';

/** Human claim code: GIFT-<base36 time>-<rand4> (BDD-1 shape). */
export function giftClaimCode(at = Date.now(), rand = Math.floor(Math.random() * 36 ** 4)): string {
  return `GIFT-${at.toString(36).toUpperCase()}-${rand.toString(36).toUpperCase().padStart(4, '0')}`;
}

/** Expiry instant for a creation time + policy days. */
export function giftExpiryAt(createdAt: number, expiryDays = GIFT_DEFAULT_EXPIRY_DAYS): string {
  return new Date(createdAt + expiryDays * 86_400_000).toISOString();
}

/** Claim-window guard: READY_TO_CLAIM + unexpired. */
export function canClaim(gift: { status: string; expiresAt: number }, now = Date.now()): boolean {
  return gift.status === 'READY_TO_CLAIM' && now < gift.expiresAt;
}

/** Viral K-factor: claimed / sent (1-decimal, §7.1). */
export function giftKFactor(sent: number, claimed: number): number {
  if (sent <= 0) return 0;
  return Math.round((claimed / sent) * 1000) / 1000;
}

/** Claim deep-link into the LIFF gift entry. */
export function giftClaimUrl(origin: string, claimCode: string): string {
  return `${origin.replace(/\/$/, '')}/gift/claim?code=${encodeURIComponent(claimCode)}`;
}

/** Redis single-claim mutex key (§8.1 redlock seam). */
export function giftClaimLockKey(claimCode: string): string {
  return `lock:gift:claim:${claimCode}`;
}
