'use client';

// SSOT Phase 073 BDD-3 — Payout console (3% e-Withholding live preview)
// Canonical: apps/frontend/app/(dashboard)/merchant/payouts/page.tsx
import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { netPayoutFor } from '@repo/shared';
import { merchantApi } from '../../../../lib/dashboard/dashboard-client';

function PayoutsInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const [amount, setAmount] = useState('50000');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = netPayoutFor(Number(amount) || 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await merchantApi(slug).payout({
        requestedAmount: Number(amount),
        bankAccountId: '00000000-0000-0000-0000-000000000000',
      });
      setMsg(`สร้างคำขอ ${res.payoutId} สำเร็จ — รับสุทธิ ฿${res.netAmount}`);
    } catch (err) {
      setMsg(`ERROR: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>เบิกถอนเงิน</h1>
      <form onSubmit={submit} className="merchant-form">
        <input placeholder="ยอดถอน (ขั้นต่ำ 1,000)" type="number" min={1000} value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <p>หักภาษี 3%: ฿{preview.tax.toFixed(2)} + ค่าธรรมเนียม: ฿{preview.fee.toFixed(2)} = รับสุทธิ ฿{preview.net.toFixed(2)}</p>
        <button type="submit" disabled={busy}>{busy ? 'กำลังส่งคำขอ…' : 'ขอเบิกถอน'}</button>
      </form>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}

export default function MerchantPayoutsPage() {
  return (
    <Suspense fallback={null}>
      <PayoutsInner />
    </Suspense>
  );
}
