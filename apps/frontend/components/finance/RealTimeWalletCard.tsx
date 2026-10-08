// SSOT Phase 081 §6.1 — Real-time wallet card + payout drawer (dep-free)
// Canonical: apps/frontend/components/finance/RealTimeWalletCard.tsx
// - Animated balance (SSE-fed via overview prop), 3% live preview, debounce
//   lock on submit (LOADING disables double-tap). Tenant vars (§2.1).
// - Zero-dep (React only — no shadcn/lucide/recharts, RAM <30MB).
'use client';

import React, { useState } from 'react';
import { financeApi, previewWithholding, type FinancialOverview } from '../../lib/finance/finance-client';

export function RealTimeWalletCard({ slug, overview }: { slug: string; overview: FinancialOverview }) {
  const [amount, setAmount] = useState('5000');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const current = Number(amount) || 0;
  const preview = previewWithholding(current);
  const valid = current >= 100 && current <= overview.withdrawableBalance && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await financeApi(slug).payout({
        requestedAmount: current,
        bankAccountId: '00000000-0000-0000-0000-000000000000',
      });
      setMsg(`ขอถอน ${res.grossAmount} บาท — หักภาษี ${res.taxAmount} รับสุทธิ ${res.netAmount} (${res.status})`);
      setAmount('');
    } catch (err) {
      setMsg(`ERROR: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ background: 'var(--finance-positive-color,#10B981)' }}>
        <p>ยอดเงินถอนได้ (Withdrawable Balance)</p>
        <p>฿{overview.withdrawableBalance.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</p>
        <p>
          รอรับ: ฿{overview.pendingEscrowBalance.toLocaleString('th-TH')} · สะสมตลอดชีพ:
          ฿{overview.totalEarnedLifetime.toLocaleString('th-TH')} · ภาษีที่หักไว้:
          ฿{overview.taxWithheldLifetime.toLocaleString('th-TH')}
        </p>
      </div>
      <form onSubmit={submit}>
        <label>
          จำนวนเงินที่ต้องการถอน (THB)
          <input type="number" min={100} placeholder="ขั้นต่ำ 100 บาท" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        {current >= 100 && (
          <div>
            <div>ยอดเงินถอนขั้นต้น: ฿{current.toFixed(2)}</div>
            <div>หัก ภาษี ณ ที่จ่าย (3%): -฿{preview.tax.toFixed(2)}</div>
            <div>ยอดโอนสุทธิเข้าบัญชี: ฿{preview.net.toFixed(2)}</div>
          </div>
        )}
        <button type="submit" disabled={!valid}>
          {busy ? 'กำลังประมวลผล…' : 'ยืนยันการถอนเงิน'}
        </button>
      </form>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}
