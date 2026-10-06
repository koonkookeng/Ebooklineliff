// SSOT Phase 007 §6.1 — QR display (presentational: QR + countdown ring + blur/refresh states)
// Canonical: apps/frontend/components/auth/qr-code-display.tsx
// (legacy src/frontend/components/auth/qr-code-display.tsx)
'use client';

import React from 'react';
import QRCode from 'react-qr-code';

export type QrDisplayStatus = 'INIT' | 'PENDING' | 'SCANNED' | 'SUCCESS' | 'EXPIRED' | 'ERROR';

export function QrCodeDisplay({
  value,
  status,
  countdownSec,
  tenantName,
  pinDisplay,
  onRefresh,
}: {
  value: string | null;
  status: QrDisplayStatus;
  countdownSec: number;
  tenantName?: string;
  pinDisplay?: string | null;
  onRefresh: () => void;
}) {
  const showQr = (status === 'PENDING' || status === 'SCANNED') && !!value;
  return (
    <div className="flex flex-col items-center justify-center p-6 bg-white rounded-2xl shadow-xl border border-gray-100 max-w-sm mx-auto">
      <h3 className="text-xl font-bold text-gray-900 mb-2">สแกนเพื่อเข้าสู่ระบบ</h3>
      <p className="text-sm text-gray-500 mb-6 text-center">
        เปิดแอป LINE เพื่อสแกน QR Code นี้{tenantName ? ` (${tenantName})` : ''}
      </p>

      <div className="relative flex items-center justify-center w-64 h-64 bg-gray-50 rounded-xl border border-gray-200">
        {status === 'INIT' && (
          <div className="w-10 h-10 rounded-full border-4 border-emerald-200 border-t-emerald-500 animate-spin" aria-label="loading" />
        )}

        {showQr && (
          <>
            <QRCode value={value as string} size={220} aria-label="QR code for LINE login" />
            {status === 'SCANNED' && (
              <div className="absolute inset-0 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center p-4">
                <p className="text-sm font-semibold text-gray-800">สแกนสำเร็จแล้ว!</p>
                <p className="text-xs text-gray-500">กรุณากดยืนยันตัวตนบนสมาร์ทโฟน</p>
              </div>
            )}
          </>
        )}

        {(status === 'EXPIRED' || status === 'ERROR') && (
          <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center p-4">
            <p className="text-sm font-medium text-gray-700 mb-4">
              {status === 'EXPIRED' ? 'QR Code หมดอายุ' : 'เกิดข้อผิดพลาดในการเชื่อมต่อ'}
            </p>
            <button
              onClick={onRefresh}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition"
            >
              รีเฟรช QR Code
            </button>
          </div>
        )}

        {status === 'SUCCESS' && (
          <div className="absolute inset-0 bg-white flex flex-col items-center justify-center p-4">
            <p className="text-sm font-semibold text-emerald-600">เข้าสู่ระบบสำเร็จ</p>
            <p className="text-xs text-gray-500">กำลังพาไปยัง Dashboard...</p>
          </div>
        )}
      </div>

      {(status === 'PENDING' || status === 'SCANNED') && (
        <p className="mt-4 text-xs text-gray-400">
          QR Code จะหมดอายุภายใน <span className="font-semibold text-emerald-600">{countdownSec}</span> วินาที
        </p>
      )}

      {pinDisplay && (status === 'PENDING' || status === 'SCANNED') && (
        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-center">
          <p className="text-xs text-amber-800">กรอก PIN นี้บนสมาร์ทโฟนเพื่อยืนยัน</p>
          <p className="text-2xl font-bold tracking-widest text-amber-900" aria-label="one-time PIN">
            {pinDisplay}
          </p>
        </div>
      )}
    </div>
  );
}

export default QrCodeDisplay;
