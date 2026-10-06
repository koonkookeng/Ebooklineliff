// SSOT Phase 012 §6.1 — PromptPay QR + auto-upload modal (5 states, <20MB RAM)
// Canonical: apps/frontend/components/payment/PromptPayQrModal.tsx
// (legacy src/frontend/components/payment/PromptPayQrModal.tsx)
// QR rendered locally via react-qr-code (zero-egress, no external QR API).
'use client';

import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { uploadSlipImage, verifyPaymentSlip } from '../../lib/checkout';

export type PayUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface Props {
  orderId: string;
  qrPayload: string;
  amount: number;
  expiresAt: string;
  liffReady?: boolean;
  onSuccess?: (unlockedIds: string[]) => void;
}

const MAX_SLIP_BYTES = 5 * 1024 * 1024;

function remainingSec(expiresAt: string): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

export function PromptPayQrModal({ orderId, qrPayload, amount, expiresAt, liffReady = true, onSuccess }: Props) {
  const [uiState, setUiState] = useState<PayUiState>(liffReady ? 'IDLE' : 'LIFF_INIT');
  const [phase, setPhase] = useState<'pay' | 'verifying' | 'done'>('pay');
  const [error, setError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [left, setLeft] = useState(() => remainingSec(expiresAt));
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!liffReady) {
      setUiState('LIFF_INIT');
      return;
    }
    setUiState('IDLE');
  }, [liffReady]);

  useEffect(() => {
    const t = setInterval(() => setLeft(remainingSec(expiresAt)), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError('กรุณาเลือกไฟล์ภาพ PNG, JPEG หรือ WebP');
      setUiState('ERROR');
      return;
    }
    if (file.size > MAX_SLIP_BYTES) {
      setError('ไฟล์สลิปต้องไม่เกิน 5 MB');
      setUiState('ERROR');
      return;
    }
    setError(null);
    setPhase('verifying');
    setUiState('LOADING');
    try {
      const { slipImageUrl } = await uploadSlipImage(orderId, file);
      const result = await verifyPaymentSlip(orderId, slipImageUrl);
      setUnlocked(result.entitlementsGranted);
      setPhase('done');
      setUiState('SUCCESS');
      onSuccess?.(result.entitlementsGranted);
    } catch (err) {
      setError((err as Error).message || 'เกิดข้อผิดพลาดในการตรวจสลิป');
      setPhase('pay');
      setUiState('ERROR');
    }
  };

  if (uiState === 'LIFF_INIT') {
    return (
      <div className="p-6 bg-white rounded-2xl shadow-xl max-w-sm mx-auto" aria-busy="true">
        <div className="h-6 w-40 rounded bg-gray-100 animate-pulse mx-auto" />
        <div className="w-64 h-64 rounded-xl bg-gray-100 animate-pulse mx-auto mt-4" />
      </div>
    );
  }

  if (uiState === 'SUCCESS') {
    return (
      <div className="flex flex-col items-center p-6 bg-white rounded-2xl shadow-xl max-w-sm mx-auto text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-3xl animate-pulse">✓</div>
        <h3 className="mt-3 text-lg font-bold text-gray-900">ชำระเงินสำเร็จ</h3>
        <p className="text-sm text-gray-500 mt-1">ปลดล็อกแล้ว {unlocked.length} รายการ — เข้าถึงได้ทันที</p>
        <div className="mt-4 flex gap-2 w-full">
          <a href="/library" className="flex-1 py-3 bg-emerald-600 text-white font-bold rounded-xl text-sm text-center">
            เปิดอ่าน / เข้าเรียนทันที
          </a>
        </div>
      </div>
    );
  }

  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');

  return (
    <div className="flex flex-col items-center p-6 bg-white rounded-2xl shadow-xl max-w-sm mx-auto">
      <h3 className="text-lg font-bold text-gray-900 mb-1">สแกนชำระเงิน PromptPay</h3>
      <p className="text-sm text-gray-500 mb-1">
        ยอดชำระสุทธิ {amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
      </p>
      <p className={`text-xs mb-4 ${left < 120 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
        หมดอายุใน {mm}:{ss} นาที
      </p>

      <div className="w-64 h-64 border-4 border-emerald-500 rounded-xl overflow-hidden mb-4 p-3 bg-white">
        <QRCode value={qrPayload} size={232} style={{ width: '100%', height: '100%' }} />
      </div>

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uiState === 'LOADING' || left <= 0}
        className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-medium py-3 rounded-xl transition"
      >
        {uiState === 'LOADING' ? 'กำลังตรวจสอบสลิป (< 1 วินาที)...' : 'อัปโหลดสลิปเพื่อปลดล็อกทันที'}
      </button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} disabled={uiState === 'LOADING'} className="hidden" />

      {error && (
        <div className="mt-3 p-3 bg-red-50 text-red-600 text-xs rounded-lg text-center w-full" role="alert">
          {error}
          <button type="button" onClick={() => { setError(null); setUiState('IDLE'); }} className="block mx-auto mt-1 font-bold underline">
            ลองใหม่อีกครั้ง
          </button>
        </div>
      )}
      {phase === 'verifying' && uiState === 'LOADING' && (
        <p className="mt-2 text-[11px] text-gray-400">กำลังตรวจสอบสลิปผ่านระบบธนาคาร...</p>
      )}
    </div>
  );
}

export default PromptPayQrModal;
