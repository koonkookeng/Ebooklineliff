// SSOT Phase 117 Task 4 — discount result value object (stack combine)
// Canonical: apps/backend/src/modules/campaign/domain/value-objects/discount-result.vo.ts
// (legacy src/backend/modules/campaign/domain/value-objects/discount-result.vo.ts)
// - One line per applied coupon (platform/seller/shipping legs always sum to
//   the line total). combine() folds N lines into totals with Net ≥ 0
//   invariant (§10 over-discount guard). Pure. Zero new deps.
import type { CampaignDiscountBreakdown, CouponType, StackLane } from '@repo/shared';

export interface DiscountLine extends CampaignDiscountBreakdown {
  lane: StackLane;
  couponType: CouponType;
}

export interface CombinedDiscount {
  totalDiscountAmount: number;
  platformDiscount: number;
  sellerDiscount: number;
  shippingDiscount: number;
  netAmount: number;
  lines: DiscountLine[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Fold stacked lines against a gross cart total (Net floored at 0). */
export function combineDiscounts(grossTotal: number, shippingFee: number, lines: DiscountLine[]): CombinedDiscount {
  let platform = 0;
  let seller = 0;
  let shipping = 0;
  for (const line of lines) {
    platform += line.platformDiscount;
    seller += line.sellerDiscount;
    shipping += line.shippingDiscount;
  }
  const total = round2(platform + seller + shipping);
  const gross = round2(grossTotal + shippingFee);
  return {
    totalDiscountAmount: Math.min(total, gross),
    platformDiscount: round2(platform),
    sellerDiscount: round2(seller),
    shippingDiscount: round2(Math.min(shipping, shippingFee)),
    netAmount: Math.max(0, round2(gross - total)),
    lines,
  };
}
