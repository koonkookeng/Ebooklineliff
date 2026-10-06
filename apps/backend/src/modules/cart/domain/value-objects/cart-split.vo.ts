// SSOT Phase 011 §5.1 — Cart split value object (pure totals; no I/O)
// Canonical: apps/backend/src/modules/cart/domain/value-objects/cart-split.vo.ts
// Rules: digital discount NEVER touches shipping; physical shipping from weight tiers;
// zero-weight physical falls back to minimum fee (Edge Case 2).
import type { HybridCartSplitSummary, SmartCartItem } from '@repo/shared';

export interface SplitInputItem extends SmartCartItem {}

/** Tiered weight pricing (THB): 0g→min fee fallback, ≤500g→35, ≤2000g→55, else 85. */
export function tieredShippingFee(weightGrams: number): number {
  if (weightGrams <= 0) return 35;
  if (weightGrams <= 500) return 35;
  if (weightGrams <= 2000) return 55;
  return 85;
}

/**
 * Split items + compute summary. `digitalDiscount` applies to the digital subtotal only
 * (Edge Case 3: never reduces the shipping fee). Totals rounded to 2 decimals.
 */
export function splitCart(
  items: SplitInputItem[],
  estimatedShippingFee: number,
  digitalDiscount = 0,
): HybridCartSplitSummary {
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  const digitalItems = items.filter((i) => i.itemCategory === 'DIGITAL');
  const physicalItems = items.filter((i) => i.itemCategory === 'PHYSICAL');
  const digitalSubtotal = round2(digitalItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0));
  const physicalSubtotal = round2(physicalItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0));
  const totalPhysicalWeightGrams = physicalItems.reduce((s, i) => s + i.weightGrams * i.quantity, 0);
  // Clamp discount to digital subtotal (never negative, never leaks into shipping).
  const appliedDiscountAmount = round2(Math.max(0, Math.min(digitalDiscount, digitalSubtotal)));
  const shipping = physicalItems.length > 0 ? round2(Math.max(0, estimatedShippingFee)) : 0;
  const grandTotalAmount = round2(digitalSubtotal - appliedDiscountAmount + physicalSubtotal + shipping);
  return {
    digitalItems,
    physicalItems,
    digitalSubtotal,
    physicalSubtotal,
    totalPhysicalWeightGrams,
    estimatedShippingFee: shipping,
    appliedDiscountAmount,
    grandTotalAmount,
    requiresShippingAddress: physicalItems.length > 0,
  };
}

/** Empty summary (no cart row yet) — satisfies the same Zod contract. */
export function emptyCartSummary(): HybridCartSplitSummary {
  return {
    digitalItems: [],
    physicalItems: [],
    digitalSubtotal: 0,
    physicalSubtotal: 0,
    totalPhysicalWeightGrams: 0,
    estimatedShippingFee: 0,
    appliedDiscountAmount: 0,
    grandTotalAmount: 0,
    requiresShippingAddress: false,
  };
}
