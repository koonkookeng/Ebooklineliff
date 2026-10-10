// SSOT Phase 117 §6.1/Tasks 5-6 — LIFF campaigns center (5-state)
// Canonical: apps/frontend/app/(liff)/campaigns/page.tsx
// - LIFF_INIT (campaign splash) -> IDLE (eligible + custom code) ->
//   LOADING (claim/validate pulse + optimistic savings) -> SUCCESS (badge +
//   savings card) / ERROR (Thai reason toast + retry). My-coupons survive
//   offline via IndexedDB (§2.1). Zero new deps.
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CouponSelector } from '@/components/checkout/coupon-selector';
import { campaignApi, type CampaignUiState, type CampaignView, type CouponValidateView } from '@/lib/campaign/campaign-client';

function CampaignsInner() {
  const params = useSearchParams();
  const tenant = params.get('tenant') ?? 'default';
  const [state, setState] = useState<CampaignUiState>('LIFF_INIT');
  const [campaigns, setCampaigns] = useState<CampaignView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<CouponValidateView | null>(null);

  const load = useCallback(async () => {
    try {
      setCampaigns(await campaignApi(tenant).active());
      setState('IDLE');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดแคมเปญไม่สำเร็จ');
      setState('ERROR');
    }
  }, [tenant]);

  useEffect(() => {
    void load();
  }, [load]);

  async function validate(code: string, cart: { cartItems: Array<{ productId: string; sellerId: string; productType: string; price: number; quantity: number }>; shippingFee: number }): Promise<CouponValidateView | null> {
    setBusy(true);
    setState('LOADING');
    setError(null);
    try {
      const out = await campaignApi(tenant).validate({ couponCode: code, ...cart });
      setApplied(out);
      setState('SUCCESS');
      return out;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ตรวจสอบไม่สำเร็จ');
      setState('ERROR');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function claim(code: string): Promise<void> {
    setBusy(true);
    try {
      await campaignApi(tenant).claim(code);
      setState('SUCCESS');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เก็บโค้ดไม่สำเร็จ');
      setState('ERROR');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'LIFF_INIT') return <p>กำลังโหลดแคมเปญ…</p>;

  const eligible = campaigns.flatMap((c) => c.coupons);

  return (
    <div>
      <h1>แคมเปญ & คูปองของฉัน</h1>
      {campaigns.map((c) => (
        <section key={c.slug} data-testid="campaign-card" data-slug={c.slug}>
          <h2>{c.name}</h2>
          {c.description && <p>{c.description}</p>}
        </section>
      ))}
      {state === 'ERROR' && (
        <p role="alert">
          {error ?? 'เกิดข้อผิดพลาด'}{' '}
          <button type="button" onClick={() => void load()}>
            ลองใหม่
          </button>
        </p>
      )}
      <CouponSelector
        eligible={eligible}
        busy={busy}
        error={state === 'ERROR' ? error : null}
        applied={applied}
        onValidate={validate}
        onClaim={claim}
        onApplyDiscount={setApplied}
      />
    </div>
  );
}

export default function LiffCampaignsPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดแคมเปญ…</p>}>
      <CampaignsInner />
    </Suspense>
  );
}
