// SSOT Phase 088 §3.1 — Stackable coupon + points contract
// Canonical: packages/shared/src/schemas/promotion.schema.ts
// (legacy src/shared/schemas/promotion.schema.ts — placeholder until now)
// - Spec-verbatim: DiscountTypeEnum / DiscountTargetEnum /
//   ApplyCouponInputSchema / DiscountBreakdownSchema (§3.1).
// - RISK_CALL (documented): Prisma CouponType/CouponScope start at the 088
//   §4.1 sets (3 types / 4 scopes); the schema.md union (117 values) lands
//   as an additive extension in 117. Points math reuses User.rewardPoints
//   (083 wallet) — no second points ledger.
// - Pure helpers: layered stack math (BDD-1: 500+50 → 50+50+50 → net 350),
//   eligibility, quota guards, lock/velocity keys, stream name.
// - Zero new deps (zod only).
import { z } from 'zod';

export const DiscountTypeEnum = z.enum(['FIXED_AMOUNT', 'PERCENTAGE', 'FREE_SHIPPING']);
export type DiscountType = z.infer<typeof DiscountTypeEnum>;

export const DiscountTargetEnum = z.enum(['ENTIRE_ORDER', 'SPECIFIC_PRODUCT', 'SPECIFIC_CATEGORY', 'SHIPPING_FEE']);
export type DiscountTarget = z.infer<typeof DiscountTargetEnum>;

export const ApplyCouponInputSchema = z.object({
  tenantId: z.string().min(1),
  cartId: z.string().uuid(),
  shopCouponCode: z.string().trim().toUpperCase().optional(),
  freeShippingCouponCode: z.string().trim().toUpperCase().optional(),
  redeemPoints: z.number().int().min(0).default(0),
});
export type ApplyCouponInput = z.infer<typeof ApplyCouponInputSchema>;

export const DiscountBreakdownSchema = z.object({
  subtotal: z.number().nonnegative(),
  shopCouponDiscount: z.number().nonnegative(),
  shippingFeeOriginal: z.number().nonnegative(),
  shippingDiscount: z.number().nonnegative(),
  pointsDiscount: z.number().nonnegative(),
  pointsRedeemed: z.number().int().nonnegative(),
  netAmount: z.number().nonnegative(),
  appliedShopCoupon: z.object({
    code: z.string(),
    title: z.string(),
  }).nullable(),
  appliedFreeShippingCoupon: z.object({
    code: z.string(),
    title: z.string(),
  }).nullable(),
});
export type DiscountBreakdown = z.infer<typeof DiscountBreakdownSchema>;

/** Loyalty rate: 10 points = 1 THB (§4.1 PointRedemptionRule default). */
export const POINTS_PER_THB = 10;
/** Minimum redeemable lot: 100 points. */
export const POINTS_MIN_REDEEM = 100;
/** Points may cover at most 50% of the post-coupon subtotal. */
export const POINTS_MAX_PCT = 50;
/** Coupon-grab rate limit: 5 code tries/min per user (§8 anti-enumeration). */
export const COUPON_TRY_LIMIT = 5;
export const COUPON_TRY_WINDOW_SEC = 60;
/** Promotion event stream (Gate 8). */
export const PROMOTION_STREAM = 'stream:promotion:events';

export interface StackLineInput {
  subtotal: number;
  shippingFee: number;
  shopCoupon?: { discountValue: number; isPercent: boolean; maxDiscountAmount: number | null } | null;
  freeShipCoupon?: { maxOffset: number | null } | null;
  redeemPoints?: number;
  walletPoints?: number;
}

/**
 * Layered stack (BDD-1 order, corrected arithmetic): shop %/fixed →
 * shipping offset → points on the remainder. Net never negative. Pure +
 * synchronous (<50ms budget shape).
 * {500, ship 50, 10% SHOP10, FREESHIP cap 50, 500pts} → net **400**
 * (RISK_CALL erratum: the phase text claims 350, but 500−50−50−50+50−50
 * = 400; the engine implements the correct equation and the contract
 * test pins 400).
 */
export function stackDiscounts(input: StackLineInput): {
  shopCouponDiscount: number;
  shippingDiscount: number;
  pointsDiscount: number;
  pointsRedeemed: number;
  netAmount: number;
} {
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  let shop = 0;
  if (input.shopCoupon) {
    shop = input.shopCoupon.isPercent
      ? (input.subtotal * input.shopCoupon.discountValue) / 100
      : input.shopCoupon.discountValue;
    if (input.shopCoupon.maxDiscountAmount != null) shop = Math.min(shop, input.shopCoupon.maxDiscountAmount);
    shop = Math.min(round2(shop), input.subtotal);
  }
  const afterShop = round2(input.subtotal - shop);
  let ship = 0;
  if (input.freeShipCoupon) {
    const cap = input.freeShipCoupon.maxOffset ?? input.shippingFee;
    ship = Math.min(input.shippingFee, cap);
  }
  let pointsDiscount = 0;
  let pointsRedeemed = 0;
  const want = Math.min(input.redeemPoints ?? 0, input.walletPoints ?? 0);
  if (want >= POINTS_MIN_REDEEM && afterShop > 0) {
    const value = Math.floor(want / POINTS_PER_THB);
    const cap = (afterShop * POINTS_MAX_PCT) / 100;
    pointsDiscount = Math.min(value, cap);
    pointsRedeemed = Math.min(want, Math.floor(Math.min(value, cap) * POINTS_PER_THB));
    pointsDiscount = round2(Math.floor(pointsRedeemed / POINTS_PER_THB));
  }
  const net = Math.max(0, round2(afterShop - pointsDiscount + (input.shippingFee - ship)));
  return { shopCouponDiscount: round2(shop), shippingDiscount: round2(ship), pointsDiscount, pointsRedeemed, netAmount: net };
}

/** Coupon live-window check (UTC, server truth). */
export function isCouponLive(coupon: { isActive: boolean; startAt: number; expireAt: number }, now = Date.now()): boolean {
  return coupon.isActive && coupon.startAt <= now && now <= coupon.expireAt;
}

/** Quota headroom (never negative; BDD-2 zero-over-redemption). */
export function quotaLeft(totalQuota: number, usedQuota: number): number {
  return Math.max(0, totalQuota - usedQuota);
}

/** Redis Redlock key for a coupon grab (§8). */
export function couponLockKey(code: string): string {
  return `lock:coupon:${code.toUpperCase()}`;
}

/** Anti-enumeration velocity key (§8: 5 tries/min). */
export function couponTryKey(userId: string): string {
  return `promo:coupon:try:${userId}`;
}
