// SSOT Phase 015 §6.1 — Real-time slip upload zone (dropzone → atomic verify)
// Canonical: apps/frontend/components/checkout/slip-upload-zone.tsx
// (legacy src/frontend/components/checkout/slip-upload-zone.tsx)
// Reuses useSlipVerification (canvas ≤300KB compress → R2 → <0.8s verify).
// No icon deps (repo policy): inline SVG only.
'use client';

import React, { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSlipVerification } from '../../hooks/useSlipVerification';

interface SlipUploadZoneProps {
  orderId: string;
  tenantId: string;
  expectedAmount: number;
  onSuccessNavigateUrl: string;
  accentColor?: string;
}

export function SlipUploadZone({
  orderId,
  tenantId,
  expectedAmount,
  onSuccessNavigateUrl,
  accentColor = '#059669',
}: SlipUploadZoneProps) {
  const { verifySlip, stage, uiState, error, result } = useSlipVerification();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const busy = uiState === 'LOADING';

  const upload = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy) return;
    const res = await verifySlip(orderId, file, tenantId);
    if (res?.success) {
      setTimeout(() => {
        router.push(onSuccessNavigateUrl);
        router.refresh();
      }, 1200);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 bg-white rounded-2xl shadow-xl border border-gray-100">
      <div className="text-center mb-4">
        <h3 className="text-lg font-bold text-gray-900">อัปโหลดสลิปชำระเงิน</h3>
        <p className="text-sm text-gray-500">
          ยอดที่ต้องชำระ: ฿{expectedAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
        </p>
      </div>

      {uiState === 'SUCCESS' && result ? (
        <div className="flex flex-col items-center justify-center p-6 space-y-3 bg-emerald-500/10 text-emerald-600 rounded-xl">
          <span className="w-12 h-12 rounded-full bg-emerald-100 text-3xl flex items-center justify-center">✓</span>
          <p className="font-semibold text-center">ตรวจสอบสำเร็จ! ปลดล็อกสิทธิ์แล้ว ({result.processedInMs}ms)</p>
          <span className="text-xs text-gray-500">กำลังนำคุณไปยังหน้าคลังเนื้อหา...</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex flex-col items-center justify-center w-full h-44 border-2 border-dashed rounded-xl cursor-pointer transition-all disabled:opacity-60"
          style={{ borderColor: `${accentColor}66`, background: `${accentColor}0d` }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={upload}
            disabled={busy}
          />
          <span className="flex flex-col items-center justify-center px-4 text-center">
            {busy ? (
              <>
                <svg className="w-10 h-10 animate-spin mb-2" style={{ color: accentColor }} fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <p className="text-sm font-medium text-gray-900">
                  {stage === 'compressing' && 'กำลังบีบอัดภาพ...'}
                  {stage === 'uploading' && 'กำลังอัปโหลดสลิป...'}
                  {(stage === 'verifying' || stage === 'idle') && 'กำลังตรวจสอบสลิปกับระบบธนาคาร...'}
                </p>
              </>
            ) : (
              <>
                <svg className="w-10 h-10 mb-2" style={{ color: accentColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.9A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm font-semibold text-gray-900">กดเพื่อเลือกรูปสลิปจากเครื่อง</p>
                <p className="text-xs text-gray-500 mt-1">รองรับ PNG, JPG, WEBP (บีบอัด ≤300KB อัตโนมัติ)</p>
              </>
            )}
          </span>
        </button>
      )}

      {error && (
        <div className="flex items-center gap-2 mt-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm" role="alert">
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

export default SlipUploadZone;
