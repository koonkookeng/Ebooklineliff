// SSOT Phase 117 §6.1 — LIFF coupon selector (dep-free, <15MB UI budget)
// Canonical: apps/frontend/components/checkout/coupon-selector.tsx
// - Custom code input (uppercase) + eligible list + optimistic savings +
//   Thai reason toasts. No tanstack/lucide (bundle guard + RAM discipline:
//   text-only rows, no artwork). Zero new deps (React only).
'use client';

import React, { useState } from 'react';
import type { CampaignCouponView, CouponValidateView } from '../../lib/campaign/campaign-client';

export function CouponSelector(props: {
  eligible: CampaignCouponView[];
  busy: boolean;
  error: string | null;
  applied: CouponValidateView | null;
  cartItems?: Array<{ productId: string; sellerId: string; productType: string; price: number; quantity: number }>;
  shippingFee?: number;
  onValidate: (code: string, cart: { cartItems: Array<{ productId: string; sellerId: string; productType: string; price: number; quantity: number }>; shippingFee: number }) => Promise<CouponValidateView | null>;
  onClaim: (code: string) => Promise<unknown>;
  onApplyDiscount: (data: CouponValidateView) => void;
}) {
  const { eligible, busy, error, applied, cartItems = [], shippingFee = 0, onValidate, onClaim, onApplyDiscount } = props;
  const [code, setCode] = useState('');
  const [claimed, setClaimed] = useState<Set<string>>(new Set());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    const out = await onValidate(code.trim(), { cartItems, shippingFee }).catch(() => null);
    if (out) onApplyDiscount(out);
  }

  async function collect(couponCode: string) {
    await onClaim(couponCode).catch(() => undefined);
    setClaimed((s) => new Set(s).add(couponCode));
  }

  return (
    <div>
      <h3>โค้ดส่วนลดส่วนกลางและร้านค้า</h3>
      <form onSubmit={submit}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="กรอกโค้ดส่วนลด (เช่น MEGA117)"
          aria-label="โค้ดส่วนลด"
          maxLength={30}
          style={{ textTransform: 'uppercase' }}
        />
        <button type="submit" disabled={!code.trim() || busy}>
          {busy ? 'กำลังตรวจ…' : 'ใช้โค้ด'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {applied && (
        <p role="status" data-testid="coupon-applied">
          ประหยัด {applied.totalDiscountAmount.toLocaleString()} บาท · ยอดสุทธิ {applied.netAmount.toLocaleString()} บาท
        </p>
      )}
      <ul>
        {eligible.map((c) => (
          <li key={c.code} data-testid="coupon-row" data-code={c.code}>
            <strong>{c.code}</strong> · {c.couponType} · ลด {Number(c.discountValue).toLocaleString()}
            {c.endDate ? ` · ถึง ${new Date(c.endDate).toLocaleDateString('th-TH')}` : ''}
            {' '}
            {claimed.has(c.code) ? (
              <span>เก็บแล้ว</span>
            ) : (
              <button type="button" onClick={() => void collect(c.code)} disabled={busy}>
                เก็บโค้ด
              </button>
            )}
          </li>
        ))}
      </ul>
      {eligible.length === 0 && <p>ยังไม่มีคูปองที่ใช้ได้ตอนนี้</p>}
    </div>
  );
}
