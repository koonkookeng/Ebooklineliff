// SSOT Phase 017 §2/§6 — Wallet balance card (LIFF RAM <20MB, tenant CSS vars)
// Canonical: apps/frontend/components/wallet/WalletBalanceCard.tsx
'use client';

import React from 'react';
import type { WalletBalanceResponse } from '../../lib/wallet';

interface Props {
  balance: WalletBalanceResponse | null;
  blurred?: boolean;
  accent?: string;
  onTopup?: () => void;
}

export function WalletBalanceCard({ balance, blurred = false, accent = '#059669', onTopup }: Props) {
  return (
    <section
      className="rounded-2xl p-5 text-white shadow-xl"
      style={{ background: `linear-gradient(135deg, ${accent}, #065f46)`, ['--wallet-primary-color' as string]: accent }}
      aria-live="polite"
    >
      <p className="text-xs opacity-80">Meb-Killer Credits (คงเหลือ)</p>
      <p className={`mt-1 text-3xl font-extrabold tabular-nums ${blurred ? 'blur-sm select-none' : ''}`}>
        {balance ? `฿${balance.totalBalance.toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '฿••.••'}
      </p>
      <div className="mt-2 flex gap-3 text-[11px] opacity-90">
        <span>หลัก: ฿{(balance?.mainBalance ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
        <span>โบนัส: ฿{(balance?.bonusBalance ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
      </div>
      {onTopup && (
        <button
          type="button"
          onClick={onTopup}
          className="mt-4 w-full py-2.5 bg-white/95 font-bold rounded-xl text-sm"
          style={{ color: accent }}
        >
          เติมเงิน + รับโบนัส 10%
        </button>
      )}
    </section>
  );
}

export default WalletBalanceCard;
