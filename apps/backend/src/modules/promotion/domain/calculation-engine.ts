// SSOT Phase 088 §5.1/§9 — Stackable calculation engine (single math source)
// Canonical: apps/backend/src/modules/promotion/domain/calculation-engine.ts
// - calculateStack: thin typed wrapper over the contract stackDiscounts
//   pure (§9 — resolvers, services and the order adapter all call here).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { stackDiscounts, type StackLineInput } from '@repo/shared';

@Injectable()
export class CalculationEngine {
  calculate(input: StackLineInput): {
    shopCouponDiscount: number;
    shippingDiscount: number;
    pointsDiscount: number;
    pointsRedeemed: number;
    netAmount: number;
  } {
    const t0 = Date.now();
    const out = stackDiscounts(input);
    void t0;
    return out;
  }
}

/** Standalone pure (DB-free unit shape). */
export function calculateStack(input: StackLineInput): ReturnType<typeof stackDiscounts> {
  return stackDiscounts(input);
}
