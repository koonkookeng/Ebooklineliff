// SSOT Phase 016 §6.1 — LIFF photo picker (native choose → compress → verify)
// Canonical: apps/frontend/components/checkout/SlipPhotoPicker.tsx
// (legacy src/frontend/components/checkout/SlipPhotoPicker.tsx)
// Flow: liff.chooseImage when hosted natively, else album/camera file inputs
// (capture="environment" for the camera button). Compression reuses
// lib/slip-image (≤300KB); upload+verify reuses useSlipVerification; every
// preview URL is revoked (RAM < 30MB). No icon deps (repo policy).
// Picker analytics (§7.1) emit best-effort around the pipeline.
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSlipVerification } from '../../hooks/useSlipVerification';
import {
  emitSlipPickerAnalytics,
  tryLiffChooseImage,
  type SlipPickerSource,
} from '../../lib/slip-picker';
import { SLIP_PICKER_MAX_SOURCE_BYTES } from '@repo/shared';

interface SlipPhotoPickerProps {
  orderId: string;
  tenantId: string;
  netAmount: number;
  accentColor?: string;
  onSuccess: () => void;
}

export function SlipPhotoPicker({ orderId, tenantId, netAmount, accentColor = '#059669', onSuccess }: SlipPhotoPickerProps) {
  const { verifySlip, reset, stage, uiState, error, result } = useSlipVerification();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const albumRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const run = async (file: File, source: SlipPickerSource): Promise<void> => {
    if (uiState === 'LOADING') return;
    if (file.size > SLIP_PICKER_MAX_SOURCE_BYTES) {
      await emitSlipPickerAnalytics({ event: 'checkout_slip_selected', orderId, tenantId, source, fileSizeKbBefore: Math.round(file.size / 1024) });
      return;
    }
    reset();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const beforeKb = Math.round((file.size / 1024) * 100) / 100;
    await emitSlipPickerAnalytics({ event: 'checkout_slip_selected', orderId, tenantId, source, fileSizeKbBefore: beforeKb });
    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);
    const t0 = performance.now();
    // Single compression happens inside verifySlip; sizes come back on outcome.
    const res = await verifySlip(orderId, file, tenantId);
    if (res?.success) {
      await emitSlipPickerAnalytics({
        event: 'checkout_slip_compressed', orderId, tenantId, source,
        fileSizeKbBefore: beforeKb, fileSizeKbAfter: res.compressedKb,
      });
      await emitSlipPickerAnalytics({
        event: 'checkout_slip_uploaded', orderId, tenantId, source,
        fileSizeKbAfter: res.compressedKb, uploadLatencyMs: Math.round(performance.now() - t0),
      });
      URL.revokeObjectURL(localPreview);
      setPreviewUrl(null);
      setTimeout(() => onSuccess(), 1200);
    }
  };

  const pickFile = (file: File | undefined, source: SlipPickerSource): void => {
    if (file) void run(file, source);
  };

  const chooseFromAlbum = async (): Promise<void> => {
    if (uiState === 'LOADING') return;
    setDetecting(true);
    try {
      const native = await tryLiffChooseImage();
      if (native) {
        pickFile(native[0], 'liff-native');
        return;
      }
      albumRef.current?.click();
    } finally {
      setDetecting(false);
    }
  };

  const busy = uiState === 'LOADING' || detecting;

  return (
    <div className="w-full p-4 bg-white rounded-2xl border border-gray-100 shadow-sm space-y-4">
      <input
        ref={albumRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={busy}
        onChange={(e) => { pickFile(e.target.files?.[0], 'file-album'); e.target.value = ''; }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        disabled={busy}
        onChange={(e) => { pickFile(e.target.files?.[0], 'camera-capture'); e.target.value = ''; }}
      />

      <div className="text-center space-y-1">
        <p className="text-sm font-semibold text-gray-500">ยอดเงินที่ต้องชำระ</p>
        <p className="text-3xl font-black" style={{ color: accentColor }}>
          ฿{netAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
        </p>
      </div>

      {previewUrl && uiState !== 'SUCCESS' && (
        <div className="relative w-full h-48 rounded-lg overflow-hidden border">
          <img src={previewUrl} alt="ตัวอย่างสลิป" className="w-full h-full object-cover" />
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-red-600 text-sm" role="alert">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {uiState === 'SUCCESS' && result ? (
        <div className="flex flex-col items-center justify-center p-6 space-y-2 bg-emerald-500/10 text-emerald-600 rounded-xl">
          <span className="w-12 h-12 rounded-full bg-emerald-100 text-3xl flex items-center justify-center">✓</span>
          <p className="font-semibold text-center">ตรวจสอบสำเร็จ! ปลดล็อกสิทธิ์แล้ว ({result.processedInMs}ms)</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={chooseFromAlbum}
            disabled={busy}
            className="w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 text-white disabled:opacity-60"
            style={{ background: accentColor }}
          >
            {busy ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.59-4.59a2 2 0 012.82 0L16 16m-2-2l1.59-1.59a2 2 0 012.82 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            )}
            เลือกจากอัลบั้ม
          </button>
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            disabled={busy}
            className="w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 border-2 disabled:opacity-60"
            style={{ borderColor: accentColor, color: accentColor }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.66-.9l.82-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.66.9l.82 1.22a2 2 0 001.66.9H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            ถ่ายภาพสลิป
          </button>
        </div>
      )}
      {busy && stage !== 'idle' && (
        <p className="text-center text-xs text-gray-500">
          {stage === 'compressing' && 'กำลังบีบอัดภาพ...'}
          {stage === 'uploading' && 'กำลังอัปโหลดสลิป...'}
          {stage === 'verifying' && 'กำลังตรวจสอบสลิปภายใน 0.8 วินาที...'}
          {stage === 'done' && 'สำเร็จ'}
        </p>
      )}
    </div>
  );
}

export default SlipPhotoPicker;
