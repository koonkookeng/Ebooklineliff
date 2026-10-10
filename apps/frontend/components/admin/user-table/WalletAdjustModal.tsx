// SSOT Phase 109 §6 — wallet adjustment modal (audited, reason-gated)
// Canonical: apps/frontend/components/admin/user-table/WalletAdjustModal.tsx
// - Amount ≠ 0, reason ≥ 5 chars. Negative result is rejected server-side.
// - Zero new deps.
'use client';

import React, { useState } from 'react';

interface WalletAdjustModalProps {
  userId: string | null;
  displayName?: string;
  onClose: () => void;
  onSubmit: (userId: string, amount: number, reason: string) => Promise<void>;
  busy: boolean;
}

export const WalletAdjustModal: React.FC<WalletAdjustModalProps> = ({
  userId,
  displayName,
  onClose,
  onSubmit,
  busy,
}) => {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const parsed = Number(amount);
  const valid = userId !== null && Number.isFinite(parsed) && parsed !== 0 && reason.trim().length >= 5;

  if (!userId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-label="ปรับยอดเงิน">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-6">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">ปรับยอดเงิน{displayName ? ` · ${displayName}` : ''}</h2>
        <p className="text-xs text-slate-500 mt-1">ทุกการปรับจะบันทึกลง WalletAuditLedger พร้อม Audit Log</p>

        <label className="block text-sm font-medium mt-4 mb-1" htmlFor="wallet-amount">จำนวน (+เติม / −หัก)</label>
        <input
          id="wallet-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="เช่น 500 หรือ -200"
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 font-mono"
        />

        <label className="block text-sm font-medium mt-4 mb-1" htmlFor="wallet-reason">เหตุผล (≥ 5 ตัวอักษร)</label>
        <textarea
          id="wallet-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-sm"
          placeholder="เช่น ชดเชยออเดอร์ซ้ำ"
        />

        <div className="mt-5 flex gap-3 justify-end">
          <button onClick={onClose} className="px-5 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200">ยกเลิก</button>
          <button
            onClick={() => valid && onSubmit(userId, parsed, reason.trim())}
            disabled={!valid || busy}
            className="px-5 py-2 text-sm text-white rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? 'กำลังบันทึก…' : 'ยืนยันปรับยอด'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WalletAdjustModal;
