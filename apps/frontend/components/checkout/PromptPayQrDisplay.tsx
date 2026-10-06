// SSOT Phase 016 §2.2 — Presentational dynamic QR display (no fetch logic)
// Canonical: apps/frontend/components/checkout/PromptPayQrDisplay.tsx
// (legacy src/frontend/components/checkout/PromptPayQrDisplay.tsx)
// QR renders locally via react-qr-code (zero-egress, <30MB). The composed
// checkout page pairs this with SlipPhotoPicker (spec IDLE matrix); the
// bundled PromptPayQRWidget flow is untouched.
'use client';

import React, { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';

interface Props {
  qrPayload: string;
  amount: number;
  expiresAt: string;
  brandColor?: string;
  logoUrl?: string;
  compact?: boolean;
}

function remainingSec(expiresAt: string): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

function formatTime(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

export function PromptPayQrDisplay({ qrPayload, amount, expiresAt, brandColor = '#059669', logoUrl, compact = false }: Props) {
  const [left, setLeft] = useState(() => remainingSec(expiresAt));
  const expired = left <= 0;

  useEffect(() => {
    const t = setInterval(() => setLeft(remainingSec(expiresAt)), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const size = compact ? 'w-40 h-40' : 'w-64 h-64';

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-2 mb-2">
        {logoUrl && <img src={logoUrl} alt="" className="h-6" />}
        <h3 className="text-lg font-bold text-gray-900">สแกนชำระเงิน PromptPay</h3>
      </div>
      <div className={`${size} rounded-xl overflow-hidden p-3 bg-white border-4 ${expired ? 'opacity-40 grayscale' : ''}`} style={{ borderColor: brandColor }}>
        <QRCode value={qrPayload} size={232} style={{ width: '100%', height: '100%' }} />
      </div>
      <p className="mt-2 text-3xl font-extrabold" style={{ color: expired ? '#9ca3af' : brandColor }}>
        {amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
      </p>
      <div className="mt-2 flex items-center gap-2 bg-gray-100 px-4 py-1.5 rounded-full">
        <span className="text-xs text-gray-600">เวลาที่เหลือ:</span>
        <span className={`text-sm font-bold ${left < 120 ? 'text-red-500' : 'text-gray-800'}`}>
          {expired ? 'หมดอายุ' : formatTime(left)}
        </span>
      </div>
    </div>
  );
}

export default PromptPayQrDisplay;
