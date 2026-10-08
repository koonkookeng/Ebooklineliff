// SSOT Phase 081 Task 7 — Seller finance workspace (5-state)
// Canonical: apps/frontend/app/(dashboard)/seller/finance/page.tsx
'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFinanceWallet } from '../../../../hooks/useFinanceWallet';
import { RealTimeWalletCard } from '../../../../components/finance/RealTimeWalletCard';
import { LedgerHistory } from '../../../../components/finance/LedgerHistory';

function SellerFinanceInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const { status, error, overview, retry } = useFinanceWallet(slug);

  if (status === 'LIFF_INIT' || status === 'LOADING') return <p>กำลังโหลดบัญชีการเงิน…</p>;
  if (status === 'ERROR' || !overview) {
    return (
      <div>
        <p role="alert">โหลดไม่สำเร็จ{error ? `: ${error}` : ''}</p>
        <button type="button" onClick={retry}>
          ลองใหม่
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1>การเงินผู้ขาย</h1>
      <RealTimeWalletCard slug={slug} overview={overview} />
      <LedgerHistory slug={slug} />
    </div>
  );
}

export default function SellerFinancePage() {
  return (
    <Suspense fallback={<p>กำลังโหลดบัญชีการเงิน…</p>}>
      <SellerFinanceInner />
    </Suspense>
  );
}
