// SSOT Phase 115 §6.1 — manual override modal (dep-free)
// Canonical: apps/frontend/components/reconciliation/OverrideModal.tsx
// - Statement evidence box + target order input + justification (≥10) +
//   checker pin (optional) + dual-control notice for >1000 THB.
// - Zero new deps (React only).
'use client';

import React, { useState } from 'react';
import type { BankStatementView } from '../../lib/reconciliation/reconciliation-client';

export function OverrideModal(props: {
  statement: BankStatementView;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: { statementId: string; orderId: string; overrideReason: string; adjustmentNote?: string; checkerUserId?: string }) => Promise<unknown>;
}) {
  const { statement, busy, error, onClose, onSubmit } = props;
  const [orderId, setOrderId] = useState('');
  const [reason, setReason] = useState('');
  const [checkerId, setCheckerId] = useState('');
  const over1k = Number(statement.amount) > 1000;
  const ready = orderId.trim().length > 0 && reason.trim().length >= 10 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    await onSubmit({
      statementId: statement.id,
      orderId: orderId.trim(),
      overrideReason: reason.trim(),
      ...(checkerId.trim() ? { checkerUserId: checkerId.trim() } : {}),
    }).catch(() => undefined);
  }

  return (
    <div role="dialog" aria-label="Manual override" style={{ border: '1px solid #334155', borderRadius: 8, padding: 12 }}>
      <h3>Execute Financial Manual Override</h3>
      <p data-testid="override-evidence">
        Ref {statement.transRef || 'N/A'} · {Number(statement.amount).toFixed(2)} THB · {statement.mismatchReason || 'Unmatched'}
      </p>
      {over1k && <p role="note">ยอดเกิน ฿1,000 — ต้องผ่าน Checker อนุมัติ (dual control)</p>}
      <form onSubmit={submit}>
        <label>
          Target System Order ID
          <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="order uuid" required />
        </label>
        <label>
          Audit Justification (≥10 chars, required)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={{ width: '100%' }} required minLength={10} maxLength={500} />
        </label>
        <label>
          Designated Checker ID (optional pin)
          <input value={checkerId} onChange={(e) => setCheckerId(e.target.value)} placeholder="checker uuid" />
        </label>
        {error && <p role="alert">{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={!ready}>
            {busy ? 'Processing Audit Chain…' : 'Confirm & Unlock Entitlements'}
          </button>
          <button type="button" onClick={onClose}>
            ปิด
          </button>
        </div>
      </form>
    </div>
  );
}
