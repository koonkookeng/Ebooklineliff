// SSOT Phase 007 §6.1/§2.1 — LIFF scan-confirm UI (confirm drawer + PIN step-up + offline fallback)
// Canonical: apps/frontend/components/auth/qr-code-scanner.tsx
// (legacy src/frontend/components/auth/qr-code-scanner.tsx)
// RAM <20MB: no camera libs; deep-link carries qrToken+envelope, native scanner optional.
'use client';

import React, { useState } from 'react';

export type QrScanStatus = 'IDLE' | 'CONFIRMING' | 'SUCCESS' | 'ERROR';

export function QrCodeScanner({
  qrToken,
  requirePin,
  serverPinHint,
  status,
  error,
  onConfirm,
  onReject,
}: {
  qrToken: string;
  requirePin: boolean;
  serverPinHint: string | null;
  status: QrScanStatus;
  error: string | null;
  onConfirm: (pin?: string) => void;
  onReject: () => void;
}) {
  const [pin, setPin] = useState('');
  const [offlineQueued, setOfflineQueued] = useState(false);

  const submit = () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      // OFFLINE_FIRST: queue the intent, auto-retry comes from the page effect
      setOfflineQueued(true);
      return;
    }
    setOfflineQueued(false);
    onConfirm(requirePin ? pin : undefined);
  };

  return (
    <div className="flex flex-col p-6 bg-white rounded-2xl shadow-xl border border-gray-100 max-w-sm mx-auto">
      <h3 className="text-lg font-bold text-gray-900 mb-1">ยืนยันการเข้าสู่ระบบ</h3>
      <p className="text-xs text-gray-500 mb-4">
        Desktop ขอเข้าสู่ระบบด้วยบัญชีนี้ · <span className="font-mono">{qrToken.slice(0, 8)}…</span>
      </p>

      {requirePin && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs text-amber-800 mb-2">
            ตรวจพบความเสี่ยงสูง กรุณากรอก PIN 6 หลักที่แสดงบนหน้าจอ Desktop
          </p>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            placeholder="••••••"
            aria-label="6-digit PIN"
            className="w-full px-3 py-2 text-center text-xl tracking-widest border rounded-lg"
          />
          {serverPinHint && <p className="mt-1 text-[11px] text-gray-400">(dev hint: {serverPinHint})</p>}
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {offlineQueued && (
        <p className="mb-3 text-sm text-amber-600">ออฟไลน์อยู่ — บันทึกคิวแล้ว จะลองใหม่อัตโนมัติเมื่อมีสัญญาณ</p>
      )}
      {status === 'SUCCESS' && <p className="mb-3 text-sm text-emerald-600">ยืนยันสำเร็จ Desktop กำลังเข้าสู่ระบบ</p>}

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={status === 'CONFIRMING' || (requirePin && pin.length !== 6)}
          className="flex-1 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition disabled:opacity-50"
        >
          {status === 'CONFIRMING' ? 'กำลังยืนยัน...' : 'ยืนยันตัวตน'}
        </button>
        <button
          onClick={onReject}
          disabled={status === 'CONFIRMING' || status === 'SUCCESS'}
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition disabled:opacity-50"
        >
          ปฏิเสธ
        </button>
      </div>
    </div>
  );
}

export default QrCodeScanner;
