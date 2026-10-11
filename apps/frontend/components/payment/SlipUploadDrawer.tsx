// SSOT Phase 124 Task 6 §6.1 — slip upload drawer (chaos queued lane)
// Canonical: apps/frontend/components/payment/SlipUploadDrawer.tsx
// (legacy src/frontend/components/payment/SlipUploadDrawer.tsx)
// - Mirrors the 014 SlipUploadModal pipeline (same hook, same ≤300KB
//   compress, inline SVG only) plus the BDD-2 optimistic pending lane:
//   a queued/outbox-shaped result renders SLIP_QUEUED_MESSAGE ("บันทึก
//   เข้าคิว...") instead of the success tick. The 014 hook/modal stay
//   untouched — this drawer only branches on the result shape.
// - Zero new deps.
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSlipVerification, type SlipUiState } from '../../hooks/useSlipVerification';
import { SLIP_QUEUED_MESSAGE } from '@repo/shared';

interface SlipUploadDrawerProps {
  orderId: string;
  tenantId: string;
  netAmount: number;
  accentColor?: string;
  onSuccess: () => void;
  onQueued?: () => void;
}

function isQueuedResult(result: unknown): boolean {
  return (
    result !== null &&
    typeof result === 'object' &&
    ((result as Record<string, unknown>)['queued'] === true ||
      (result as Record<string, unknown>)['status'] === 'PAYMENT_VERIFYING_PENDING')
  );
}

export function SlipUploadDrawer({ orderId, tenantId, netAmount, accentColor = '#059669', onSuccess, onQueued }: SlipUploadDrawerProps) {
  const { verifySlip, reset, stage, uiState, error, result } = useSlipVerification();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const queued = result !== null && isQueuedResult(result);

  useEffect(() => {
    if (queued) onQueued?.();
  }, [queued, onQueued]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const next = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!next) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    reset();
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
  };

  const submit = (): void => {
    if (!file || uiState === 'LOADING') return;
    void verifySlip(orderId, file, tenantId).then((res) => {
      if (res && !isQueuedResult(res)) setTimeout(() => onSuccess(), 1500);
    });
  };

  const state: SlipUiState = uiState;

  return (
    <div className="p-6 bg-white rounded-2xl shadow-xl max-w-md w-full mx-auto">
      <h3 className="text-xl font-bold text-gray-900 mb-2">แนบสลิปโอนเงิน PromptPay</h3>
      <p className="text-sm text-gray-500 mb-4">
        ยอดเงินที่ต้องโอน: <span className="font-bold" style={{ color: accentColor }}>{netAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</span>
      </p>

      {error && !queued && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-red-600 text-sm" role="alert">
          <span>{error}</span>
        </div>
      )}

      {queued ? (
        <div className="py-8 text-center flex flex-col items-center" role="status">
          <span className="w-16 h-16 rounded-full bg-amber-100 text-amber-500 text-4xl flex items-center justify-center mb-3">◷</span>
          <h4 className="text-lg font-bold text-gray-800">รับสลิปเข้าคิวตรวจสอบแล้ว</h4>
          <p className="text-sm text-gray-500 mt-1">{SLIP_QUEUED_MESSAGE}</p>
        </div>
      ) : state === 'SUCCESS' && result ? (
        <div className="py-8 text-center flex flex-col items-center">
          <span className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-500 text-4xl flex items-center justify-center mb-3">✓</span>
          <h4 className="text-lg font-bold text-gray-800">ชำระเงินสำเร็จ!</h4>
          <p className="text-sm text-gray-500">กำลังนำท่านเข้าสู่คลังสินค้าดิจิทัล...</p>
        </div>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={state === 'LOADING'}
            className="w-full border-2 border-dashed border-gray-300 rounded-xl p-4 text-center hover:border-emerald-500 transition-colors cursor-pointer disabled:opacity-60"
          >
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} className="hidden" />
            {previewUrl ? (
              <img src={previewUrl} alt="ตัวอย่างสลิป" className="max-h-48 rounded-lg object-contain mx-auto mb-2" />
            ) : (
              <span className="flex flex-col items-center">
                <span className="text-sm text-gray-600">กดเพื่อเลือกรูปภาพสลิปจากอัลบั้ม</span>
                <span className="text-[11px] text-gray-400 mt-1">บีบอัดอัตโนมัติ ≤300KB ก่อนส่ง</span>
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={submit}
            disabled={!file || state === 'LOADING'}
            className="w-full py-3 text-white font-semibold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: accentColor }}
          >
            {state === 'LOADING' ? (
              <span>
                {stage === 'compressing' && 'กำลังบีบอัดภาพ...'}
                {stage === 'uploading' && 'กำลังอัปโหลดสลิป...'}
                {(stage === 'verifying' || stage === 'idle') && 'กำลังตรวจสอบสลิปภายใน 0.8 วินาที...'}
              </span>
            ) : (
              <span>ยืนยันการโอนเงิน</span>
            )}
          </button>

          {error && (
            <button type="button" onClick={() => { reset(); }} className="w-full text-xs text-gray-500 underline">
              ลองใหม่อีกครั้ง
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default SlipUploadDrawer;
