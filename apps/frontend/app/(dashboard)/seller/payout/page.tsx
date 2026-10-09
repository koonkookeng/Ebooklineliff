// SSOT Phase 086 Task 6 — Seller payout studio (5-state + SSE revalidate)
// Canonical: apps/frontend/app/(dashboard)/seller/payout/page.tsx
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PayoutRequestForm } from '../../../../components/payout/PayoutRequestForm';
import { payoutApi } from '../../../../lib/payout/payout-client';
import { financeApi } from '../../../../lib/finance/finance-client';

type UiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

function SellerPayoutInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const [ui, setUi] = useState<UiState>('LIFF_INIT');
  const [balance, setBalance] = useState(0);
  const [kycVerified, setKycVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [overview, kyc] = await Promise.all([
        financeApi(slug).overview(),
        fetch(`/api/v1/kyc/status?tenant=${encodeURIComponent(slug)}`).then((r) => r.json() as Promise<{ kycStatus: string }>).catch(() => ({ kycStatus: 'UNKNOWN' })),
      ]);
      setBalance(overview.withdrawableBalance);
      setKycVerified(kyc.kycStatus === 'VERIFIED');
      setUi('IDLE');
    } catch (e) {
      setError((e as Error).message);
      setUi('ERROR');
    }
  }, [slug]);

  useEffect(() => {
    void load();
    let es: EventSource | null = null;
    try {
      es = new EventSource(payoutApi(slug).financeStreamUrl());
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { withdrawableBalance?: number };
          if (typeof data.withdrawableBalance === 'number') setBalance(data.withdrawableBalance);
        } catch {
          // Malformed frame — next poll covers it.
        }
      };
    } catch {
      // SSE unsupported — focus revalidation covers it.
    }
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      es?.close();
      window.removeEventListener('focus', onFocus);
    };
  }, [load, slug]);

  async function submit(amount: number) {
    setUi('LOADING');
    setError(null);
    try {
      const res = await payoutApi(slug).request(amount, '00000000-0000-0000-0000-000000000000');
      setNotice(`ขอถอน ${res.grossAmount} บาท — หักภาษี ${res.taxAmount} รับสุทธิ ${res.netAmount} (${res.status})`);
      setUi('SUCCESS');
      await load();
    } catch (e) {
      setError((e as Error).message);
      setUi('ERROR');
      throw e;
    }
  }

  if (ui === 'LIFF_INIT') return <p>กำลังโหลดห้องถอนเงิน…</p>;
  if (ui === 'LOADING') return <p>กำลังประมวลผลธุรกรรมทางการเงินกับธนาคาร…</p>;

  return (
    <div>
      <h1>ถอนเงินรายได้</h1>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert">
          {error} <button type="button" onClick={() => void load()}>ลองใหม่</button>
        </p>
      )}
      <PayoutRequestForm availableBalance={balance} kycVerified={kycVerified} onRequestSubmit={submit} />
    </div>
  );
}

export default function SellerPayoutPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดห้องถอนเงิน…</p>}>
      <SellerPayoutInner />
    </Suspense>
  );
}
