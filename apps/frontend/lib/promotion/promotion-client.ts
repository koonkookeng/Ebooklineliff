// SSOT Phase 088 §2 — Promotion client (REST transport)
// Canonical: apps/frontend/lib/promotion/promotion-client.ts
// - Zero-dep (fetch only).
export type PromoStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface CouponScheme {
  code: string;
  title: string;
  couponType: string;
  discountValue: number;
}

export interface DiscountQuote {
  subtotal: number;
  shopCouponDiscount: number;
  shippingFeeOriginal: number;
  shippingDiscount: number;
  pointsDiscount: number;
  pointsRedeemed: number;
  netAmount: number;
  appliedShopCoupon: { code: string; title: string } | null;
  appliedFreeShippingCoupon: { code: string; title: string } | null;
  isSuccess: boolean;
  errorMessage: string | null;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`promotion ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function promoApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  return {
    eligible: (subtotal: number) =>
      json<CouponScheme[]>(`/api/v1/promotion/eligible?${qs}&subtotal=${subtotal}`),
    pointsBalance: () => json<{ points: number }>(`/api/v1/promotion/points-balance?${qs}`),
    calculate: (body: unknown) =>
      json<DiscountQuote>(`/api/v1/promotion/calculate?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}
