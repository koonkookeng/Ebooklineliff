// SSOT Phase 112 §6.2 — admin moderation studio queue (dep-free)
// Canonical: apps/frontend/components/moderation/ModerationQueue.tsx
// - Cards with severity badge + confidence + flagged categories +
//   violating locations + Approve (publish) / Reject (stay quarantined)
//   with mandatory admin notes. No shadcn dependency (bundle guard).
// - Zero new deps (React only).
'use client';

import React, { useState } from 'react';
import type { ModerationStatusView } from '../../lib/moderation/moderation-client';

export function severityColor(severity: string): 'green' | 'yellow' | 'red' {
  if (severity === 'CRITICAL' || severity === 'HIGH') return 'red';
  if (severity === 'MEDIUM') return 'yellow';
  return 'green';
}

export function ModerationQueue(props: {
  items: ModerationStatusView[];
  busy: boolean;
  onReview: (productId: string, approve: boolean, adminNotes: string) => Promise<unknown>;
}) {
  const { items, busy, onReview } = props;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  async function review(productId: string, approve: boolean) {
    const adminNotes = (notes[productId] ?? '').trim() || (approve ? 'Verified by Admin Studio' : 'ยืนยันการกักกัน — ละเมิดนโยบาย');
    await onReview(productId, approve, adminNotes).catch(() => undefined);
    setToast(approve ? 'อนุมัติแล้ว — วางขายทั่วโลก' : 'กักกันต่อ — แจ้ง Creator แล้ว');
  }

  if (items.length === 0) return <p>ไม่มีคิวรอตรวจสอบ</p>;

  return (
    <div>
      <ul style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', padding: 0, listStyle: 'none' }}>
        {items.map((item) => (
          <li key={`${item.productId}-${item.id ?? 'pending'}`} style={{ border: '1px solid #fecaca', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Product: {item.productId.slice(0, 8)}…</span>
              <strong data-testid="mod-score">Score: {(Number(item.confidenceScore) * 100).toFixed(1)}%</strong>
            </div>
            <p data-testid="mod-status">สถานะ: {item.status}</p>
            <div>
              <span>หมวดที่ถูก flag: </span>
              {item.flaggedCategories.map((cat) => (
                <span key={cat} data-testid="mod-flag" style={{ border: '1px solid #ccc', borderRadius: 4, marginRight: 4, padding: '0 4px' }}>
                  {cat}
                </span>
              ))}
            </div>
            {item.violatingLocations.length > 0 && <p>จุดที่ละเมิด: {item.violatingLocations.join(', ')}</p>}
            {item.aiAnalysisSummary && <p>AI: {item.aiAnalysisSummary}</p>}
            <input
              placeholder="บันทึกแอดมิน (บังคับ)"
              value={notes[item.productId] ?? ''}
              onChange={(e) => setNotes((n) => ({ ...n, [item.productId]: e.target.value }))}
              aria-label={`บันทึกแอดมินสำหรับ ${item.productId}`}
              style={{ width: '100%', marginTop: 8 }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => void review(item.productId, true)} disabled={busy} style={{ flex: 1 }}>
                อนุมัติวางขาย
              </button>
              <button type="button" onClick={() => void review(item.productId, false)} disabled={busy} style={{ flex: 1 }}>
                กักกันต่อ
              </button>
            </div>
          </li>
        ))}
      </ul>
      {toast && <p role="status">{toast}</p>}
    </div>
  );
}
