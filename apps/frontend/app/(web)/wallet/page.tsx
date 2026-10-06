// SSOT Phase 017 §6 — Web wallet page (mirrors LIFF, desktop layout)
// Canonical: apps/frontend/app/(web)/wallet/page.tsx
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { WalletBalanceCard } from '../../../components/wallet/WalletBalanceCard';
import { fetchWalletBalance, fetchWalletLedger, type WalletBalanceResponse, type WalletLedgerItem } from '../../../lib/wallet';

type UiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

function WebWalletInner() {
  const [uiState, setUiState] = useState<UiState>('LIFF_INIT');
  const [balance, setBalance] = useState<WalletBalanceResponse | null>(null);
  const [ledger, setLedger] = useState<WalletLedgerItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, l] = await Promise.all([fetchWalletBalance(), fetchWalletLedger(20)]);
      setBalance(b);
      setLedger(l);
      setUiState('IDLE');
    } catch (e) {
      setError((e as Error).message);
      setUiState('ERROR');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (uiState === 'LIFF_INIT') {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6" aria-busy="true">
        <div className="h-32 rounded-2xl bg-gray-100 animate-pulse" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <WalletBalanceCard balance={balance} />
      {error && <div className="mt-3 p-3 bg-red-50 text-red-600 text-xs rounded-lg" role="alert">{error}</div>}
      {uiState === 'SUCCESS' && <div className="mt-3 p-3 bg-emerald-50 text-emerald-700 text-xs rounded-lg" role="status">ยอดเงินอัปเดตแบบ Real-time แล้ว</div>}
      <section className="mt-4">
        <h2 className="text-sm font-bold mb-2">ประวัติ</h2>
        <ul className="space-y-2">
          {ledger.map((i) => (
            <li key={i.id} className="flex justify-between text-xs border rounded-xl px-3 py-2">
              <span><span className="font-bold">{i.type}</span> · {i.description.slice(0, 60)}</span>
              <span className={i.amount < 0 ? 'text-red-600 font-bold' : 'text-emerald-600 font-bold'}>
                {i.amount > 0 ? '+' : ''}{i.amount}
              </span>
            </li>
          ))}
          {ledger.length === 0 && <li className="text-xs text-gray-400">ยังไม่มีรายการ</li>}
        </ul>
      </section>
    </main>
  );
}

export default function WebWalletPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-2xl px-4 py-6"><div className="h-32 rounded-2xl bg-gray-100 animate-pulse" /></main>}>
      <WebWalletInner />
    </Suspense>
  );
}
