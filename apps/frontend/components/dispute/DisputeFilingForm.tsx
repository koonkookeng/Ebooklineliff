// SSOT Phase 113 §6.1 — LIFF dispute filing form (dep-free, offline drafts)
// Canonical: apps/frontend/components/dispute/DisputeFilingForm.tsx
// - Reason select + description (≥10) + evidence picker (client-compressed,
//   URLs staged for R2 vault lane) + refund amount + draft autosave.
//   No icon libs (bundle guard). Zero new deps (React only).
'use client';

import React, { useEffect, useState } from 'react';
import { compressDisputeImage, loadDisputeDraft, saveDisputeDraft } from '../../lib/dispute/dispute-client';

const REASONS = [
  { value: 'PHYSICAL_ITEM_DAMAGED', label: 'สินค้าชำรุดเสียหาย' },
  { value: 'PHYSICAL_ITEM_NOT_RECEIVED', label: 'ไม่ได้รับสินค้า' },
  { value: 'WRONG_ITEM_SENT', label: 'ส่งสินค้าผิด' },
  { value: 'EBOOK_FILE_CORRUPTED', label: 'ไฟล์ E-Book เสียหาย/อ่านไม่ได้' },
  { value: 'COURSE_CONTENT_MISMATCH', label: 'เนื้อหาคอร์สไม่ตรงตามที่ระบุ' },
  { value: 'DUPLICATE_PAYMENT', label: 'ชำระเงินซ้ำซ้อน' },
  { value: 'OTHER', label: 'อื่นๆ' },
] as const;

export function DisputeFilingForm(props: {
  orderId: string;
  netAmount: number;
  busy: boolean;
  error: string | null;
  onSubmit: (body: { orderId: string; reason: string; description: string; evidenceImageUrls: string[]; requestedRefundAmount: number }) => Promise<unknown>;
  onCompressed: (blob: Blob) => Promise<string>;
}) {
  const { orderId, netAmount, busy, error, onSubmit, onCompressed } = props;
  const [reason, setReason] = useState<string>('PHYSICAL_ITEM_DAMAGED');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState(String(netAmount));
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadDisputeDraft(orderId).then((d) => {
      if (alive && d) {
        setReason(d.reason);
        setDescription(d.description);
        setAmount(String(d.requestedRefundAmount));
        setDraftNote('โหลดร่างออฟไลน์ล่าสุดแล้ว');
      }
    });
    return () => {
      alive = false;
    };
  }, [orderId]);

  useEffect(() => {
    const t = setTimeout(() => {
      void saveDisputeDraft(orderId, { reason, description, requestedRefundAmount: Number(amount) || 0 });
    }, 800);
    return () => clearTimeout(t);
  }, [orderId, reason, description, amount]);

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setCompressing(true);
    try {
      for (const file of Array.from(files).slice(0, 5)) {
        const blob = await compressDisputeImage(file);
        const url = await onCompressed(blob);
        setEvidenceUrls((u) => [...u, url]);
      }
    } finally {
      setCompressing(false);
    }
  }

  const descOk = description.trim().length >= 10;
  const amountOk = Number(amount) > 0 && Number(amount) <= netAmount;
  const ready = descOk && amountOk && evidenceUrls.length >= 1 && !busy && !compressing;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    await onSubmit({ orderId, reason, description: description.trim(), evidenceImageUrls: evidenceUrls, requestedRefundAmount: Number(amount) }).catch(() => undefined);
  }

  return (
    <div>
      <h2>ยื่นข้อพิพาท & ขอคืนเงิน (Escrow Protection)</h2>
      {draftNote && <p role="status">{draftNote}</p>}
      <form onSubmit={submit}>
        <label>
          เหตุผลในการขอคืนเงิน
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>
        <label>
          รายละเอียดปัญหา (≥10 ตัวอักษร)
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={{ width: '100%' }} required minLength={10} maxLength={2000} />
        </label>
        <label>
          แนบรูป/วิดีโอหลักฐาน (≥1 ไฟล์, บีบอัดก่อนส่ง R2)
          <input type="file" accept="image/*,video/*" multiple aria-label="หลักฐานข้อพิพาท" onChange={(e) => void pick(e.target.files)} />
        </label>
        {compressing && <p>กำลังบีบอัดหลักฐาน…</p>}
        {evidenceUrls.length > 0 && <p data-testid="evidence-count">แนบหลักฐานแล้ว {evidenceUrls.length} ไฟล์</p>}
        <label>
          ยอดขอคืน (บาท, ไม่เกิน {netAmount.toLocaleString()})
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={!ready}>
          {busy ? 'กำลังส่งข้อมูล…' : `ยืนยันยื่นข้อพิพาท (วงเงิน ฿${netAmount.toLocaleString()})`}
        </button>
      </form>
    </div>
  );
}
