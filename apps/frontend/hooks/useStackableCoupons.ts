// SSOT Phase 088 §2.2 — Stackable coupons hook (5-state machine)
// Canonical: apps/frontend/hooks/useStackableCoupons.ts
// - LIFF_INIT preload (eligible + balance) -> IDLE picker -> LOADING quote
//   -> SUCCESS badges / ERROR inline + rollback (quote discarded).
// - Zero-dep beyond the promo client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { promoApi, type CouponScheme, type DiscountQuote, type PromoStatus } from '../lib/promotion/promotion-client';

export type { CouponScheme, DiscountQuote };

export function useStackableCoupons(
  slug: string,
  cartId: string,
  subtotal: number,
  shippingFee: number,
  items: Array<{ productId: string; price: number; quantity: number }> = [],
) {
  const [status, setStatus] = useState<PromoStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [eligible, setEligible] = useState<CouponScheme[]>([]);
  const [points, setPoints] = useState(0);
  const [quote, setQuote] = useState<DiscountQuote | null>(null);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    setStatus((s) => (s === 'LIFF_INIT' ? s : 'LOADING'));
    setError(null);
    try {
      const [e, p] = await Promise.all([
        promoApi(slug).eligible(subtotal),
        promoApi(slug).pointsBalance(),
      ]);
      setEligible(e);
      setPoints(p.points);
      setStatus('IDLE');
    } catch (err) {
      setError((err as Error).message);
      setStatus('ERROR');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, subtotal, nonce]);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply(codes: { shopCouponCode?: string; freeShippingCouponCode?: string; redeemPoints: number }): Promise<DiscountQuote> {
    setStatus('LOADING');
    setError(null);
    try {
      const q = await promoApi(slug).calculate({ cartId, ...codes, items, shippingFee });
      setQuote(q);
      setStatus('SUCCESS');
      return q;
    } catch (err) {
      setQuote(null);
      setError((err as Error).message);
      setStatus('ERROR');
      throw err;
    }
  }

  return {
    status,
    error,
    eligible,
    points,
    quote,
    apply,
    retry: () => {
      setError(null);
      setNonce((n) => n + 1);
    },
  };
}
