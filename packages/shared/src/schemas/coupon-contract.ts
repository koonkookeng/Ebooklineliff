// SSOT Phase 117 §3.1 — platform coupon & campaign contract
// Canonical: packages/shared/src/schemas/coupon-contract.ts
// (legacy src/shared/schemas/coupon-contract.ts)
// - Spec-verbatim: CouponTypeEnum (8) / CouponTargetTypeEnum (6) /
//   ValidateCouponInputSchema (uppercase transform) / DiscountBreakdown /
//   CouponValidationResponse.
// - RISK_CALL deviations (additive-only, documented):
//   - DiscountBreakdownSchema is owned by promotion.schema.ts (088) in the
//     barrel → this module exports CampaignDiscountBreakdownSchema (same
//     shape + sellerDiscount leg, 081/111/114 precedent).
//   - productId/sellerId accept min(1) edge vocabulary in addition to uuid
//     (Phase 023-031 precedent; LIFF deep-links carry short ids).
// - Pure helpers (cents-exact): eligibleAmount, percentDiscount (capped),
//   fixedDiscount (clamped), stackingCompatible (rule matrix), reservation
//   keys. Budgets: <50ms validate, 15-min reservation TTL, 300s meta cache,
//   10-req/min/IP edge shield.
// - Zero new deps (zod only).
import { z } from 'zod';

export const CouponTypeEnum = z.enum([
  'PLATFORM_FIXED',
  'PLATFORM_PERCENTAGE',
  'STORE_FIXED',
  'STORE_PERCENTAGE',
  'CATEGORY_SPECIFIC',
  'PRODUCT_SPECIFIC',
  'FREE_SHIPPING',
  'AFFILIATE_BOOST',
]);
export type CouponType = z.infer<typeof CouponTypeEnum>;

export const CouponTargetTypeEnum = z.enum([
  'ALL_PRODUCTS',
  'PHYSICAL_BOOK_ONLY',
  'EBOOK_ONLY',
  'COURSE_ONLY',
  'SPECIFIC_PRODUCTS',
  'SPECIFIC_SELLERS',
]);
export type CouponTargetType = z.infer<typeof CouponTargetTypeEnum>;

export const CouponCartItemSchema = z.object({
  productId: z.string().min(1),
  sellerId: z.string().min(1),
  productType: z.enum(['PHYSICAL_BOOK', 'EBOOK', 'ELEARNING_COURSE', 'LIVE_CLASS', 'HYBRID_BUNDLE']),
  price: z.number().positive(),
  quantity: z.number().int().positive(),
});
export type CouponCartItem = z.infer<typeof CouponCartItemSchema>;

export const ValidateCouponInputSchema = z.object({
  couponCode: z.string().min(1).max(30).transform((val) => val.toUpperCase().trim()),
  cartItems: z.array(CouponCartItemSchema).min(1),
  shippingFee: z.number().nonnegative().default(0),
  tenantId: z.string().optional(),
});
export type ValidateCouponInput = z.infer<typeof ValidateCouponInputSchema>;

export const CampaignDiscountBreakdownSchema = z.object({
  couponCode: z.string(),
  couponType: CouponTypeEnum,
  platformDiscount: z.number().nonnegative(),
  sellerDiscount: z.number().nonnegative(),
  shippingDiscount: z.number().nonnegative(),
  appliedItemIds: z.array(z.string().min(1)),
});
export type CampaignDiscountBreakdown = z.infer<typeof CampaignDiscountBreakdownSchema>;

export const CouponValidationResponseSchema = z.object({
  isValid: z.boolean(),
  message: z.string(),
  totalDiscountAmount: z.number().nonnegative(),
  netAmount: z.number().nonnegative(),
  breakdown: z.array(CampaignDiscountBreakdownSchema),
});
export type CouponValidationResponse = z.infer<typeof CouponValidationResponseSchema>;

export const ClaimCouponInputSchema = z.object({
  couponCode: z.string().min(1).max(30).transform((val) => val.toUpperCase().trim()),
});
export type ClaimCouponInput = z.infer<typeof ClaimCouponInputSchema>;

/** 117 §1.3 BDD: validation answers in strictly under 50ms. */
export const COUPON_VALIDATE_BUDGET_MS = 50;
/** 117 §1.3 BDD: reservation holds the slot for 15 minutes. */
export const COUPON_RESERVATION_TTL_SEC = 900;
/** Coupon metadata cache TTL: 5 minutes (spec §5.2). */
export const COUPON_META_CACHE_TTL_SEC = 300;
/** Edge shield: 10 validation req/min/IP (spec §8.1). */
export const COUPON_VALIDATE_RATE_LIMIT = 10;
export const COUPON_VALIDATE_RATE_WINDOW_SEC = 60;
/** Campaign event stream (Gate 8). */
export const CAMPAIGN_EVENT_STREAM = 'stream:campaign:events';

const toCents = (n: number): number => Math.round(n * 100);
const toThb = (c: number): number => c / 100;

/** Eligible subtotal + item ids for a coupon's target filter. */
export function eligibleAmount(
  items: CouponCartItem[],
  filter: { targetProductType?: string | null; sellerId?: string | null },
): { amount: number; appliedItemIds: string[] } {
  let cents = 0;
  const appliedItemIds: string[] = [];
  for (const item of items) {
    if (filter.targetProductType && item.productType !== filter.targetProductType) continue;
    if (filter.sellerId && item.sellerId !== filter.sellerId) continue;
    cents += toCents(item.price) * item.quantity;
    appliedItemIds.push(item.productId);
  }
  return { amount: toThb(cents), appliedItemIds };
}

/** Percentage discount with optional cap (cents-exact). */
export function percentDiscount(eligibleThb: number, percent: number, maxCapThb?: number | null): number {
  const raw = Math.round((toCents(eligibleThb) * percent) / 100);
  if (maxCapThb !== null && maxCapThb !== undefined) return Math.min(raw, toCents(maxCapThb)) / 100;
  return raw / 100;
}

/** Fixed discount clamped to the eligible subtotal (Net ≥ 0, §10). */
export function fixedDiscount(eligibleThb: number, fixedThb: number): number {
  return Math.min(toCents(eligibleThb), toCents(fixedThb)) / 100;
}

export type StackLane = 'PLATFORM' | 'STORE' | 'SHIPPING';

/** Which lane a coupon type settles in (BDD-2 split accounting). */
export function couponLane(couponType: CouponType): StackLane {
  if (couponType === 'FREE_SHIPPING') return 'SHIPPING';
  if (couponType === 'STORE_FIXED' || couponType === 'STORE_PERCENTAGE' || couponType === 'PRODUCT_SPECIFIC' || couponType === 'CATEGORY_SPECIFIC') {
    return 'STORE';
  }
  return 'PLATFORM';
}

/**
 * Stacking compatibility matrix (§BDD-2): a candidate stacks with the
 * already-applied lanes per its own canStackWith* flags.
 */
export function stackingCompatible(
  candidate: { lane: StackLane; canStackWithPlatform: boolean; canStackWithStore: boolean; canStackWithShipping: boolean },
  appliedLanes: StackLane[],
): boolean {
  for (const lane of appliedLanes) {
    if (lane === 'PLATFORM' && !candidate.canStackWithPlatform) return false;
    if (lane === 'STORE' && !candidate.canStackWithStore) return false;
    if (lane === 'SHIPPING' && !candidate.canStackWithShipping) return false;
  }
  return true;
}

export function couponMetaKey(code: string): string {
  return `coupon:meta:${code}`;
}

export function couponQuotaKey(couponId: string): string {
  return `coupon:quota:${couponId}`;
}

export function couponUserKey(userId: string, couponId: string): string {
  return `coupon:user:${userId}:${couponId}`;
}

export function couponReservationKey(userId: string, couponId: string): string {
  return `coupon:reservation:${userId}:${couponId}`;
}

/** 117 validate velocity key (10/min — distinct from 088's 5/min promo key). */
export function couponValidateTryKey(userId: string): string {
  return `coupon:validate:try:${userId}`;
}
