// SSOT Phase 014 §6.2 — Slip upload modal (compressed upload + instant verify)
// Canonical: apps/frontend/components/checkout/SlipUploadModal.tsx
// (legacy src/frontend/components/checkout/SlipUploadModal.tsx)
// No icon deps (repo policy): inline SVG glyphs only. Client compresses to
// ≤300KB before upload (RAM < 20MB). 5 states via useSlipVerification.
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSlipVerification, type SlipUiState } from '../../hooks/useSlipVerification';

interface SlipUploadModalProps {
  orderId: string;
  tenantId: string;
  netAmount: number;
  accentColor?: string;
  onSuccess: () => void;
}

export function SlipUploadModal({ orderId, tenantId, netAmount, accentColor = '#059669', onSuccess }: SlipUploadModalProps) {
  const { verifySlip, reset, stage, uiState, error, result } = useSlipVerification();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

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
      if (res?.success) setTimeout(() => onSuccess(), 1500);
    });
  };

  const state: SlipUiState = uiState;

  return (
    <div className="p-6 bg-white rounded-2xl shadow-xl max-w-md w-full mx-auto">
      <h3 className="text-xl font-bold text-gray-900 mb-2">แนบสลิปโอนเงิน PromptPay</h3>
      <p className="text-sm text-gray-500 mb-4">
        ยอดเงินที่ต้องโอน: <span className="font-bold" style={{ color: accentColor }}>{netAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</span>
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-red-600 text-sm" role="alert">
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {state === 'SUCCESS' && result ? (
        <div className="py-8 text-center flex flex-col items-center">
          <span className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-500 text-4xl flex items-center justify-center mb-3">✓</span>
          <h4 className="text-lg font-bold text-gray-800">ชำระเงินสำเร็จ!</h4>
          <p className="text-sm text-gray-500">กำลังนำท่านเข้าสู่คลังสินค้าดิจิทัล... ({result.processedInMs}ms)</p>
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
                <svg className="w-10 h-10 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
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
              <>
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span>
                  {stage === 'compressing' && 'กำลังบีบอัดภาพ...'}
                  {stage === 'uploading' && 'กำลังอัปโหลดสลิป...'}
                  {(stage === 'verifying' || stage === 'idle') && 'กำลังตรวจสอบสลิปภายใน 0.8 วินาที...'}
                </span>
              </>
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

export default SlipUploadModal;
