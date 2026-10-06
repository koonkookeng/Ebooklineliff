// SSOT Phase 017 §6 — LIFF wallet page (5-state: INIT skeleton / IDLE / LOADING / SUCCESS / ERROR)
// Canonical: apps/frontend/app/(liff)/wallet/page.tsx
// RAM budget: no heavy deps, fetch-only, blurred skeleton while LIFF init.
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { WalletBalanceCard } from '../../../components/wallet/WalletBalanceCard';
import { fetchWalletBalance, fetchWalletLedger, previewTopupBonus, type WalletBalanceResponse, type WalletLedgerItem } from '../../../lib/wallet';

type UiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

function LiffWalletInner() {
  const params = useSearchParams();
  const accent = params.get('color') ?? '#059669';
  const [uiState, setUiState] = useState<UiState>('LIFF_INIT');
  const [balance, setBalance] = useState<WalletBalanceResponse | null>(null);
  const [ledger, setLedger] = useState<WalletLedgerItem[]>([]);
  const [amount, setAmount] = useState('1000');
  const [preview, setPreview] = useState<{ bonusAmount: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
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

  const onPreview = async () => {
    setError(null);
    setNotice(null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 20) {
      setError('ขั้นต่ำในการเติมเงินคือ 20 บาท');
      return;
    }
    setUiState('LOADING');
    try {
      const p = await previewTopupBonus(n);
      setPreview({ bonusAmount: p.bonusAmount, total: p.total });
      setUiState('SUCCESS');
      setNotice(`เติม ${n} บาท รับโบนัส ${p.bonusAmount} Credits — อัปโหลดสลิปที่หน้า Checkout เพื่อเข้ากระเป๋าทันที`);
    } catch (e) {
      setError((e as Error).message);
      setUiState('ERROR');
    }
  };

  if (uiState === 'LIFF_INIT') {
    return (
      <main className="mx-auto max-w-md px-4 py-6" aria-busy="true">
        <WalletBalanceCard balance={null} blurred accent={accent} />
        <div className="mt-4 h-24 rounded-xl bg-gray-100 animate-pulse" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-6 pb-28" style={{ ['--wallet-primary-color' as string]: accent, ['--wallet-accent-color' as string]: accent }}>
      <WalletBalanceCard balance={balance} accent={accent} onTopup={() => document.getElementById('topup-amount')?.focus()} />
      {notice && <div className="mt-3 p-3 bg-emerald-50 text-emerald-700 text-xs rounded-lg" role="status">{notice}</div>}
      {error && (
        <div className="mt-3 p-3 bg-red-50 text-red-600 text-xs rounded-lg" role="alert">
          {error}
          <button type="button" onClick={() => void load()} className="ml-2 underline font-bold">ลองใหม่อีกครั้ง</button>
        </div>
      )}
      <section className="mt-4 rounded-2xl border p-4">
        <h2 className="text-sm font-bold">เติมเงินด่วน (Quick Top-up)</h2>
        <div className="mt-2 flex gap-2">
          <input
            id="topup-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="flex-1 border rounded-xl px-3 py-2 text-sm"
            placeholder="ขั้นต่ำ 20 บาท"
          />
          <button
            type="button"
            onClick={() => void onPreview()}
            disabled={uiState === 'LOADING'}
            className="px-4 py-2 text-white text-sm font-bold rounded-xl disabled:opacity-50"
            style={{ background: accent }}
          >
            {uiState === 'LOADING' ? '...' : 'คำนวณโบนัส'}
          </button>
        </div>
        {preview && <p className="mt-2 text-xs text-gray-600">โบนัส +{preview.bonusAmount} → รวม {preview.total} Credits</p>}
      </section>
      <section className="mt-4">
        <h2 className="text-sm font-bold mb-2">ประวัติ (Immutable Ledger)</h2>
        <ul className="space-y-2">
          {ledger.map((i) => (
            <li key={i.id} className="flex justify-between text-xs border rounded-xl px-3 py-2">
              <span><span className="font-bold">{i.type}</span> · {i.description.slice(0, 42)}</span>
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

export default function LiffWalletPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-4 py-6" aria-busy="true"><div className="h-32 rounded-xl bg-gray-100 animate-pulse" /></main>}>
      <LiffWalletInner />
    </Suspense>
  );
}
