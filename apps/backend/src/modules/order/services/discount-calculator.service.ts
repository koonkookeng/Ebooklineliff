// SSOT Phase 088 — Order-module discount seam (thin delegate, no core edits)
// Canonical: apps/backend/src/modules/order/services/discount-calculator.service.ts
// (legacy class name DiscountCalculatorServiceService renamed — no importers.)
// - Delegates to the promotion CalculationEngine (single source). The order
//   build calls quote() at checkout time; quota/points move via
//   coupon.consumeQuota / points.debitPoints (documented order-time seam —
//   payment core untouched).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { CalculationEngine } from '../../promotion/domain/calculation-engine';

@Injectable()
export class DiscountCalculatorService {
  constructor(private readonly engine: CalculationEngine) {}

  quoteStack(args: {
    subtotal: number;
    shippingFee: number;
    shopCoupon?: { discountValue: number; isPercent: boolean; maxDiscountAmount: number | null } | null;
    freeShipCoupon?: { maxOffset: number | null } | null;
    redeemPoints?: number;
    walletPoints?: number;
  }): {
    shopCouponDiscount: number;
    shippingDiscount: number;
    pointsDiscount: number;
    pointsRedeemed: number;
    netAmount: number;
  } {
    return this.engine.calculate(args);
  }
}
