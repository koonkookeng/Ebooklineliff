// SSOT Phase 011 §6 — Type-safe cart fetcher (server + client safe, tenant header)
// Canonical: apps/frontend/lib/cart.ts
import type { Carrier, HybridCartSplitSummary } from '@repo/shared';

export type { Carrier, HybridCartSplitSummary };

export async function fetchSmartCart(shippingAddressId?: string): Promise<HybridCartSplitSummary> {
  const qs = shippingAddressId ? `?shippingAddressId=${encodeURIComponent(shippingAddressId)}` : '';
  const res = await fetch(`/api/cart${qs}`, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error('Failed to load cart');
  return (await res.json()) as HybridCartSplitSummary;
}

export async function addCartItem(productId: string, quantity = 1): Promise<HybridCartSplitSummary> {
  const res = await fetch('/api/cart/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, quantity }),
  });
  if (!res.ok) throw new Error('Failed to add to cart');
  return (await res.json()) as HybridCartSplitSummary;
}

export interface ShippingQuoteResult {
  quotes: Array<{ carrier: Carrier; fee: number; estimatedDays: [number, number] }>;
  summary: HybridCartSplitSummary;
}

export async function quoteShipping(
  shippingAddressId: string,
  preferredCarrier?: Carrier,
): Promise<ShippingQuoteResult> {
  const res = await fetch('/api/cart/shipping/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shippingAddressId, preferredCarrier }),
  });
  if (!res.ok) throw new Error('Failed to calculate shipping');
  return (await res.json()) as ShippingQuoteResult;
}
