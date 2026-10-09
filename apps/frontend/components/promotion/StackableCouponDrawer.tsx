// SSOT Phase 088 §2.1/Task 5 — Stackable coupon drawer (dep-free)
// Canonical: apps/frontend/components/promotion/StackableCouponDrawer.tsx
// - RISK_CALL: no shadcn/slider/lucide (spec asks them) — native inputs +
//   range slider keep LIFF RAM <30MB (Gate 5); eligible/ineligible reasons
//   inline (no animation libs).
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import type { CouponScheme, DiscountQuote } from '../../hooks/useStackableCoupons';

export function StackableCouponDrawer(props: {
  userPoints: number;
  subtotal: number;
  eligible: CouponScheme[];
  onApply: (codes: { shopCouponCode?: string; freeShippingCouponCode?: string; redeemPoints: number }) => Promise<DiscountQuote>;
  onApplySuccess: (quote: DiscountQuote) => void;
}) {
  const { userPoints, subtotal, eligible, onApply, onApplySuccess } = props;
  const [shopCode, setShopCode] = useState('');
  const [shippingCode, setShippingCode] = useState('');
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<DiscountQuote | null>(null);

  const maxPoints = Math.min(userPoints, Math.floor(subtotal * 0.5 * 10));

  async function handleApply() {
    setLoading(true);
    setError(null);
    try {
      const q = await onApply({
        ...(shopCode ? { shopCouponCode: shopCode } : {}),
        ...(shippingCode ? { freeShippingCouponCode: shippingCode } : {}),
        redeemPoints: pointsToRedeem,
      });
      setQuote(q);
      onApplySuccess(q);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>ส่วนลดพิเศษ (Stackable Coupons)</h2>
      {error && <p role="alert">{error}</p>}
      <div>
        <label>
          คูปองส่วนลดร้านค้า
          <input
            placeholder="กรอกโค้ดส่วนลดร้านค้า"
            value={shopCode}
            onChange={(e) => setShopCode(e.target.value.toUpperCase())}
          />
        </label>
        <ul>
          {eligible.filter((c) => c.couponType !== 'FREE_SHIPPING').map((c) => (
            <li key={c.code}>
              <button type="button" onClick={() => setShopCode(c.code)}>
                {c.code} — {c.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <label>
          โค้ดส่งฟรี
          <input
            placeholder="กรอกโค้ดส่งฟรี"
            value={shippingCode}
            onChange={(e) => setShippingCode(e.target.value.toUpperCase())}
          />
        </label>
        <ul>
          {eligible.filter((c) => c.couponType === 'FREE_SHIPPING').map((c) => (
            <li key={c.code}>
              <button type="button" onClick={() => setShippingCode(c.code)}>
                {c.code} — {c.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <label>
          แลกแต้มสะสม (มี {userPoints.toLocaleString()} แต้ม)
          <input
            type="range"
            min={0}
            max={maxPoints}
            step={100}
            value={pointsToRedeem}
            onChange={(e) => setPointsToRedeem(Number(e.target.value))}
            aria-valuetext={`${pointsToRedeem} points`}
          />
        </label>
        <span>-{(pointsToRedeem / 10).toFixed(2)} บาท</span>
      </div>
      <button type="button" onClick={() => void handleApply()} disabled={loading}>
        {loading ? 'กำลังคำนวณส่วนลด...' : 'ตกลงใช้ส่วนลดนี้'}
      </button>
      {quote && (
        <div role="status">
          <div>ย่อย {quote.subtotal} − ร้าน {quote.shopCouponDiscount} − ส่ง {quote.shippingDiscount} − แต้ม {quote.pointsDiscount}</div>
          <div>สุทธิ ฿{quote.netAmount}</div>
        </div>
      )}
    </div>
  );
}
