// SSOT Phase 114 §6.1 — double-entry ledger table + payout form (dep-free)
// Canonical: apps/frontend/components/clearing/LedgerTable.tsx
// - Audit stream table (account/entry/amount/description/time) + creator
//   payout request form (≥100 THB floor, settled-balance aware).
// - Zero new deps (React only).
'use client';

import React, { useState } from 'react';
import { formatThb, type LedgerRowView } from '../../lib/clearing/clearing-client';

export function LedgerTable(props: { rows: LedgerRowView[] }) {
  const { rows } = props;
  if (rows.length === 0) return <p>ยังไม่มีรายการบัญชี</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Account Type</th>
          <th>Entry</th>
          <th>Amount (THB)</th>
          <th>Description</th>
          <th>Timestamp</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} data-testid="ledger-row">
            <td data-testid="ledger-account">{r.accountType}</td>
            <td data-testid="ledger-entry">{r.entryType}</td>
            <td data-testid="ledger-amount">{formatThb(r.amount)}</td>
            <td>{r.description}</td>
            <td>{new Date(r.createdAt).toLocaleString('th-TH')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PayoutRequestForm(props: {
  sellerId: string;
  available: number;
  busy: boolean;
  error: string | null;
  onSubmit: (body: { sellerId: string; requestedAmount: number; bankAccountId: string }) => Promise<unknown>;
}) {
  const { sellerId, available, busy, error, onSubmit } = props;
  const [amount, setAmount] = useState('100');
  const [bankAccountId, setBankAccountId] = useState('default');
  const n = Number(amount);
  const ok = Number.isFinite(n) && n >= 100 && n <= available && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok) return;
    await onSubmit({ sellerId, requestedAmount: n, bankAccountId }).catch(() => undefined);
  }

  return (
    <form onSubmit={submit}>
      <h3>แจ้งถอนรายได้ (ขั้นต่ำ ฿100 · หักภาษี 3%)</h3>
      <p data-testid="payout-available">ยอดถอนได้ {formatThb(available)}</p>
      <label>
        จำนวนเงิน
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required />
      </label>
      <label>
        บัญชีธนาคาร (ยืนยัน e-KYC แล้ว)
        <input value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} required />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={!ok}>
        {busy ? 'กำลังตัดจ่าย…' : 'ยืนยันถอนเงิน'}
      </button>
    </form>
  );
}
