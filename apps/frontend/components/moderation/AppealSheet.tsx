// SSOT Phase 112 §6/LIFF — creator appeal sheet (dep-free, offline drafts)
// Canonical: apps/frontend/components/moderation/AppealSheet.tsx
// - Status shield (PASSED green / QUARANTINED red / APPEAL_PENDING amber) +
//   appeal form (reason ≥10 chars + proof URLs) with IndexedDB draft
//   autosave. RAM-light: text only (Gate 5).
// - Zero new deps (React only).
'use client';

import React, { useEffect, useState } from 'react';
import { loadAppealDraft, saveAppealDraft, type ModerationStatusView } from '../../lib/moderation/moderation-client';

export function statusShield(status: string): { label: string; color: 'green' | 'red' | 'amber' | 'gray' } {
  if (status === 'PASSED' || status === 'MANUALLY_APPROVED') return { label: 'PASSED · วางขายแล้ว', color: 'green' };
  if (status === 'QUARANTINED' || status === 'REJECTED' || status.startsWith('FLAGGED')) return { label: `${status} · ถูกกักกัน`, color: 'red' };
  if (status === 'APPEAL_PENDING' || status === 'SCANNING') return { label: `${status} · กำลังดำเนินการ`, color: 'amber' };
  return { label: `${status}`, color: 'gray' };
}

export function AppealSheet(props: {
  productId: string;
  productTitle: string;
  current: ModerationStatusView | null;
  busy: boolean;
  error: string | null;
  onSubmit: (body: { productId: string; appealReason: string; proofDocumentUrls: string[] }) => Promise<unknown>;
}) {
  const { productId, productTitle, current, busy, error, onSubmit } = props;
  const [reason, setReason] = useState('');
  const [proofText, setProofText] = useState('');
  const [draftNote, setDraftNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadAppealDraft(productId).then((d) => {
      if (alive && d) {
        setReason(d.appealReason);
        setProofText(d.proofDocumentUrls.join('\n'));
        setDraftNote('โหลดร่างออฟไลน์ล่าสุดแล้ว');
      }
    });
    return () => {
      alive = false;
    };
  }, [productId]);

  useEffect(() => {
    const t = setTimeout(() => {
      void saveAppealDraft(productId, {
        appealReason: reason,
        proofDocumentUrls: proofText.split('\n').map((s) => s.trim()).filter(Boolean),
      });
    }, 800);
    return () => clearTimeout(t);
  }, [productId, reason, proofText]);

  const shield = statusShield(current?.status ?? 'PENDING_SCAN');
  const eligible = current !== null && (current.status === 'QUARANTINED' || current.status.startsWith('FLAGGED') || current.status === 'REJECTED' || current.status === 'APPEAL_PENDING');
  const reasonOk = reason.trim().length >= 10;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reasonOk || busy) return;
    await onSubmit({
      productId,
      appealReason: reason.trim(),
      proofDocumentUrls: proofText.split('\n').map((s) => s.trim()).filter(Boolean),
    }).catch(() => undefined);
  }

  return (
    <div>
      <h2>{productTitle}</h2>
      <p data-testid="appeal-shield" data-color={shield.color}>
        {shield.label}
      </p>
      {current && current.violatingLocations.length > 0 && <p>จุดที่ถูก flag: {current.violatingLocations.join(', ')}</p>}
      {draftNote && <p role="status">{draftNote}</p>}
      {eligible ? (
        <form onSubmit={submit}>
          <label>
            เหตุผลอุทธรณ์ (≥10 ตัวอักษร + หลักฐานสิทธิ์)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} style={{ width: '100%' }} required minLength={10} maxLength={2000} />
          </label>
          <label>
            ลิงก์หลักฐาน (บรรทัดละ 1 URL)
            <textarea value={proofText} onChange={(e) => setProofText(e.target.value)} rows={3} style={{ width: '100%' }} placeholder="https://…" />
          </label>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={busy || !reasonOk}>
            {busy ? 'กำลังส่งอุทธรณ์…' : 'ยื่นอุทธรณ์'}
          </button>
        </form>
      ) : (
        <p>เนื้อหาผ่านการตรวจสอบแล้ว — ไม่ต้องยื่นอุทธรณ์</p>
      )}
    </div>
  );
}
