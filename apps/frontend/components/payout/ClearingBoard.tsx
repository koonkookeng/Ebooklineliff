// SSOT Phase 086 Task 7 — Admin bulk-clearing board (dep-free)
// Canonical: apps/frontend/components/payout/ClearingBoard.tsx
// - Multi-select queue → one-click bulk approve (≤100/batch); transRef shown
//   per batch for bank reconciliation.
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import { payoutApi, type ClearingQueueItem } from '../../lib/payout/payout-client';

export function ClearingBoard({ slug, initial }: { slug: string; initial: ClearingQueueItem[] }) {
  const [rows, setRows] = useState<ClearingQueueItem[]>(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function approve() {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await payoutApi(slug).approveBatch([...selected]);
      setMsg(`เคลียร์ ${res.cleared.length} รายการ batch ${res.batchNo} (transRef ${res.transRef})`);
      setRows((prev) => prev.filter((r) => !selected.has(r.id)));
      setSelected(new Set());
    } catch (e) {
      setMsg(`ERROR: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>คิวรอเคลียร์ ({rows.length})</h2>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`select ${r.id}`} />
            <span>{r.userId}</span>
            <span>฿{r.grossAmount.toLocaleString('th-TH')} → สุทธิ ฿{r.netTransferAmount.toLocaleString('th-TH')}</span>
            <span>{r.status}</span>
          </li>
        ))}
        {rows.length === 0 && <li>ไม่มีคิวรอเคลียร์</li>}
      </ul>
      <button type="button" disabled={selected.size === 0 || busy} onClick={() => void approve()}>
        {busy ? 'กำลังเคลียร์…' : `อนุมัติ ${selected.size} รายการ`}
      </button>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}
