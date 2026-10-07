// SSOT Phase 034 Task 5/§6.2 — LINE OA add-friend prompt modal (fallback flow)
// Canonical: apps/frontend/components/auth/LineOAPromptModal.tsx
// (legacy src/frontend/components/auth/LineOAPromptModal.tsx)
// - Shown when friendship is unverified/declined (ERROR state): QR + deep-link
//   add-friend CTA + “added” re-check (parent re-runs getFriendship).
// - RISK_CALL deviation (documented): plain dep-free modal instead of shadcn
//   Dialog/Button (spec §6.2 names them) — the LIFF bundle has no shadcn Dialog
//   dep (Gate 5 zero-dep); layout/behavior match the spec.
// - Pure presentational (open + callbacks owned by the auth flow).
'use client';

import React from 'react';
import { oaAddFriendUrl, oaQrImageUrl } from '../../lib/line-oa/oa-client';

interface LineOAPromptModalProps {
  isOpen: boolean;
  lineOaBasicId: string;
  tenantName?: string;
  busy?: boolean;
  onAddedFriend: () => void;
  onClose?: () => void;
}

export function LineOAPromptModal({ isOpen, lineOaBasicId, tenantName = 'แพลตฟอร์ม', busy = false, onAddedFriend, onClose }: LineOAPromptModalProps) {
  if (!isOpen) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="เพิ่มเพื่อน LINE Official Account" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-emerald-600">เพิ่มเพื่อนเพื่อรับสิทธิ์ใช้งานเต็มรูปแบบ</h2>
        <p className="mt-2 text-sm text-gray-600">
          กรุณาเพิ่มเพื่อนกับ LINE Official Account ของ {tenantName} เพื่อรับการแจ้งเตือนหนังสือ คอร์สเรียน และสลิปการชำระเงิน
        </p>
        <div className="my-6 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={oaQrImageUrl(lineOaBasicId)} alt="LINE OA QR Code" className="h-48 w-48 rounded-xl border shadow-md" loading="lazy" />
        </div>
        <div className="flex flex-col gap-3">
          <a href={oaAddFriendUrl(lineOaBasicId)} target="_blank" rel="noopener noreferrer">
            <span className="block w-full rounded-xl bg-[#06C755] py-3 font-bold text-white">เพิ่มเพื่อนใน LINE ทันที</span>
          </a>
          <button
            type="button"
            onClick={onAddedFriend}
            disabled={busy}
            className="w-full rounded-xl border border-slate-200 py-3 font-medium disabled:opacity-50"
          >
            {busy ? 'กำลังตรวจสอบ...' : 'ฉันเพิ่มเพื่อนเรียบร้อยแล้ว'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LineOAPromptModal;
