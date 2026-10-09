// SSOT Phase 088 §5.1 — Coupon entity guards (eligibility lattice)
// Canonical: apps/backend/src/modules/promotion/domain/coupon.entity.ts
// - assertEligible: active + window + min-order + quota headroom +
//   per-user cap + type-slot match (SHOP vs FREE_SHIPPING).
// - Zero new deps.
import { BadRequestException } from '@nestjs/common';
import { isCouponLive, quotaLeft } from '@repo/shared';

export interface CouponRow {
  code: string;
  title: string;
  couponType: string;
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  totalQuota: number;
  usedQuota: number;
  perUserLimit: number;
  startAt: number;
  expireAt: number;
  isActive: boolean;
  tenantId: string | null;
}

export function assertCouponEligible(
  coupon: CouponRow | null,
  args: { subtotal: number; userUsed: number; tenantId: string; slot: 'SHOP' | 'SHIPPING' },
): asserts coupon is CouponRow {
  if (!coupon) throw new BadRequestException('INVALID_COUPON_CODE');
  if (!isCouponLive({ isActive: coupon.isActive, startAt: coupon.startAt, expireAt: coupon.expireAt })) {
    throw new BadRequestException('COUPON_EXPIRED');
  }
  if (coupon.tenantId && coupon.tenantId !== args.tenantId) {
    throw new BadRequestException('INVALID_COUPON_CODE');
  }
  if (args.subtotal < coupon.minOrderAmount) {
    throw new BadRequestException('MINIMUM_AMOUNT_NOT_REACHED');
  }
  if (quotaLeft(coupon.totalQuota, coupon.usedQuota) <= 0) {
    throw new BadRequestException('COUPON_QUOTA_EXHAUSTED');
  }
  if (args.userUsed >= coupon.perUserLimit) {
    throw new BadRequestException('COUPON_PER_USER_LIMIT');
  }
  if (args.slot === 'SHIPPING' && coupon.couponType !== 'FREE_SHIPPING') {
    throw new BadRequestException('NOT_A_SHIPPING_COUPON');
  }
  if (args.slot === 'SHOP' && coupon.couponType === 'FREE_SHIPPING') {
    throw new BadRequestException('NOT_A_SHOP_COUPON');
  }
}
