// SSOT Phase 109 §6/§8.1 — KYC inspection drawer (120s presigned docs)
// Canonical: apps/frontend/components/admin/kyc-modal/KycInspectionDrawer.tsx
// - Opens R2 presigned doc URLs (120s TTL) for visual inspection; approve /
//   reject with mandatory reason (≥5 chars). Zero new deps.
'use client';

import React, { useEffect, useState } from 'react';
import { fetchKycDocuments } from '@/lib/admin-users';

interface KycInspectionDrawerProps {
  userId: string | null;
  onClose: () => void;
  onApprove: (userId: string) => Promise<void>;
  onReject: (userId: string, reason: string) => Promise<void>;
  busy: boolean;
}

export const KycInspectionDrawer: React.FC<KycInspectionDrawerProps> = ({
  userId,
  onClose,
  onApprove,
  onReject,
  busy,
}) => {
  const [docs, setDocs] = useState<Array<{ objectKey: string; url: string; expiresIn: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    fetchKycDocuments(userId)
      .then((d) => setDocs(d.urls))
      .catch((e) => setError(e instanceof Error ? e.message : 'โหลดเอกสารไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!userId) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label="ตรวจสอบ KYC">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl bg-white dark:bg-slate-900 shadow-xl overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">ตรวจสอบ KYC</h2>
          <button onClick={onClose} aria-label="ปิด" className="p-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">×</button>
        </div>

        {loading && <p className="text-sm text-slate-500">กำลังโหลดเอกสาร…</p>}
        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="grid gap-4 my-4">
          {docs.map((d) => (
            <a key={d.objectKey} href={d.url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d.url} alt={d.objectKey} className="w-full max-h-72 object-contain bg-slate-50" />
              <p className="px-3 py-2 text-xs text-slate-500">ลิงก์หมดอายุใน {d.expiresIn} วินาที · เปิดแท็บใหม่เพื่อซูม</p>
            </a>
          ))}
          {!loading && docs.length === 0 && !error && (
            <p className="text-sm text-slate-500">ผู้ใช้ยังไม่แนบเอกสาร</p>
          )}
        </div>

        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" htmlFor="kyc-reject-reason">
          เหตุผลในการปฏิเสธ (บังคับหากกดปฏิเสธ)
        </label>
        <textarea
          id="kyc-reject-reason"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-sm"
          placeholder="เช่น ชื่อบัญชีธนาคารไม่ตรงกับบัตรประชาชน"
        />

        <div className="mt-4 flex gap-3">
          <button
            onClick={() => onApprove(userId)}
            disabled={busy}
            className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? 'กำลังบันทึก…' : 'อนุมัติ KYC'}
          </button>
          <button
            onClick={() => onReject(userId, rejectReason)}
            disabled={busy || rejectReason.trim().length < 5}
            className="flex-1 px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 disabled:opacity-50"
          >
            ปฏิเสธ KYC
          </button>
        </div>
      </aside>
    </div>
  );
};

export default KycInspectionDrawer;
