// SSOT Phase 114 Task 6 — creator payout center (5-state, dep-free)
// Canonical: apps/frontend/app/(creator)/payout-center/page.tsx
// - FIN_INIT -> IDLE (balance+form+history) -> RECONCILING? (n/a creator) —
//   creator machine: FIN_INIT/IDLE/LOADING(submit)/SETTLED(success+cert)/
//   ERROR(banner+retry). New (creator) group per IN_SCOPE mapping.
// - Zero new deps.
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PayoutRequestForm } from '@/components/clearing/LedgerTable';
import { clearingApi, formatThb, type PayoutResultView, type SellerBalanceView } from '@/lib/clearing/clearing-client';

type CreatorState = 'FIN_INIT' | 'IDLE' | 'LOADING' | 'SETTLED' | 'ERROR';

function PayoutCenterInner() {
  const params = useSearchParams();
  const tenant = params.get('tenant') ?? 'default';
  const sellerId = params.get('sellerId') ?? 'me';
  const [state, setState] = useState<CreatorState>('FIN_INIT');
  const [balance, setBalance] = useState<SellerBalanceView>({ releasedNet: 0, openPayouts: 0, completedPayouts: 0, available: 0 });
  const [last, setLast] = useState<PayoutResultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBalance(await clearingApi(tenant).sellerBalance());
      setState('IDLE');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดยอดไม่สำเร็จ');
      setState('ERROR');
    }
  }, [tenant]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(body: { sellerId: string; requestedAmount: number; bankAccountId: string }): Promise<void> {
    setBusy(true);
    try {
      const out = await clearingApi(tenant).requestPayout(body);
      setLast(out);
      setState('SETTLED');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ถอนเงินไม่สำเร็จ');
      setState('ERROR');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'FIN_INIT') return <p>กำลังโหลดศูนย์รับรายได้…</p>;

  return (
    <div>
      <h1>Creator Payout Center</h1>
      <p>
        ยอดสะสม {formatThb(balance.releasedNet)} · รอดำเนินการ {formatThb(balance.openPayouts)} · ถอนได้ {formatThb(balance.available)}
      </p>
      {state === 'SETTLED' && last && (
        <p role="status" data-testid="payout-settled">
          ตัดจ่าย {formatThb(last.netPayoutAmount)} แล้ว (หักภาษี {formatThb(last.taxAmount)}) · ref {last.payoutId.slice(0, 8)}
        </p>
      )}
      {state === 'ERROR' && (
        <p role="alert">
          {error ?? 'เกิดข้อผิดพลาด'}{' '}
          <button type="button" onClick={() => void load()}>
            ลองใหม่
          </button>
        </p>
      )}
      <PayoutRequestForm sellerId={sellerId} available={balance.available} busy={busy} error={state === 'ERROR' ? error : null} onSubmit={submit} />
      {last?.taxCertificateUrl && (
        <a href={last.taxCertificateUrl}>ดาวน์โหลด 50 ทวิ</a>
      )}
    </div>
  );
}

export default function CreatorPayoutCenterPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดศูนย์รับรายได้…</p>}>
      <PayoutCenterInner />
    </Suspense>
  );
}
