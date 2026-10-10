// SSOT Phase 117 Task 4 BDD-2 — campaign discount calculator (proportional)
// Canonical: apps/backend/src/modules/campaign/application/services/discount-calculator.service.ts
// (legacy src/backend/modules/campaign/application/services/discount-calculator.service.ts)
// - BDD-2 semantics (distinct from the 088 tiered lattice): platform legs
//   allocate proportionally across eligible items; seller legs deduct from
//   creator share while affiliate baseline is preserved (no affiliate debit
//   anywhere in this lane); FREE_SHIPPING caps at the shipping fee.
// - Cents-exact; per-line legs always sum to the line total. Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  couponLane,
  eligibleAmount,
  fixedDiscount,
  percentDiscount,
  type CouponCartItem,
  type CouponType,
} from '@repo/shared';
import { lineEligible, minPurchaseOf, type CouponRow117 } from '../../domain/entities/coupon.entity';
import type { DiscountLine } from '../../domain/value-objects/discount-result.vo';

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface CartContext {
  items: CouponCartItem[];
  shippingFee: number;
}

@Injectable()
export class DiscountCalculatorService {
  calculate(
    row: CouponRow117 & { couponType: CouponType; discountValue: number | string; maxDiscountAmount?: number | string | null; scope?: string | null },
    cart: CartContext,
    targetProductIds?: Set<string>,
  ): DiscountLine {
    const eligible = cart.items.filter((item) =>
      lineEligible(row, { productId: item.productId, sellerId: item.sellerId, productType: item.productType }, targetProductIds),
    );
    const { amount: eligibleSubtotal, appliedItemIds } = eligibleAmount(
      eligible,
      { targetProductType: row.targetProductType ?? null, sellerId: row.sellerId ?? null },
    );
    if (eligibleSubtotal < minPurchaseOf(row)) {
      throw new Error(`ยอดซื้อสินค้าที่ร่วมรายการไม่ถึงขั้นต่ำ ฿${minPurchaseOf(row)}`);
    }
    const value = Number(row.discountValue ?? 0);
    const maxCap = row.maxDiscountAmount === null || row.maxDiscountAmount === undefined ? null : Number(row.maxDiscountAmount);
    let lineTotal: number;
    if (row.couponType === 'PLATFORM_PERCENTAGE' || row.couponType === 'STORE_PERCENTAGE') {
      lineTotal = percentDiscount(eligibleSubtotal, value, maxCap);
    } else if (row.couponType === 'FREE_SHIPPING') {
      lineTotal = Math.min(cart.shippingFee, value > 0 ? value : cart.shippingFee);
      lineTotal = round2(lineTotal);
    } else {
      lineTotal = fixedDiscount(eligibleSubtotal, value);
    }

    const lane = couponLane(row.couponType);
    const scope = row.scope ?? 'GLOBAL_PLATFORM';
    const shippingDiscount = lane === 'SHIPPING' ? lineTotal : 0;
    const platformDiscount = lane === 'PLATFORM' && scope === 'GLOBAL_PLATFORM' ? lineTotal : 0;
    const sellerDiscount = round2(lineTotal - platformDiscount - shippingDiscount);
    return {
      couponCode: row.code,
      couponType: row.couponType,
      lane,
      platformDiscount,
      sellerDiscount,
      shippingDiscount,
      appliedItemIds,
    };
  }
}
