// SSOT Phase 013 §6.1 — Dynamic PromptPay QR widget (fractional cent + TTL + regenerate)
// Canonical: apps/frontend/components/checkout/PromptPayQRWidget.tsx
// (legacy src/frontend/components/checkout/PromptPayQRWidget.tsx)
// QR renders locally via react-qr-code (zero-egress, <30MB LIFF budget).
// 5 states: LIFF_INIT (skeleton+tenant theme) / IDLE (QR+countdown) /
// LOADING (slip verifying) / SUCCESS (unlocked) / EXPIRED (regenerate).
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import {
  generateDynamicQR,
  regenerateDynamicQR,
  getPromptPayQRStatus,
  uploadSlipImage,
  verifyPaymentSlip,
  type PromptPayQRPayload,
} from '../../lib/checkout';

export type QrUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'EXPIRED';

interface Props {
  orderId: string;
  liffReady?: boolean;
  tenantColor?: string;
  tenantLogo?: string;
  onSuccess?: (unlockedIds: string[]) => void;
}

const MAX_SLIP_BYTES = 5 * 1024 * 1024;
const STATUS_POLL_MS = 20_000;

function remainingSec(expiresAt: string): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function PromptPayQRWidget({ orderId, liffReady = true, tenantColor, tenantLogo, onSuccess }: Props) {
  const [uiState, setUiState] = useState<QrUiState>(liffReady ? 'LIFF_INIT' : 'LIFF_INIT');
  const [qr, setQr] = useState<PromptPayQRPayload | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const qrRef = useRef<PromptPayQRPayload | null>(null);
  qrRef.current = qr;

  const load = useCallback(async (regen: boolean) => {
    setError(null);
    setUiState('LIFF_INIT');
    try {
      const data = await (regen ? regenerateDynamicQR({ orderId }) : generateDynamicQR({ orderId }));
      setQr(data);
      setLeft(remainingSec(data.expiresAt));
      setUiState('IDLE');
    } catch (e) {
      setError((e as Error).message || 'สร้าง QR ไม่สำเร็จ');
      setUiState('EXPIRED');
    }
  }, [orderId]);

  useEffect(() => {
    if (!liffReady) {
      setUiState('LIFF_INIT');
      return;
    }
    void load(false);
  }, [liffReady, load]);

  useEffect(() => {
    if (uiState !== 'IDLE') return;
    const t = setInterval(() => {
      const cur = qrRef.current;
      if (!cur) return;
      const s = remainingSec(cur.expiresAt);
      setLeft(s);
      if (s <= 0) setUiState('EXPIRED');
    }, 1000);
    return () => clearInterval(t);
  }, [uiState]);

  useEffect(() => {
    if (uiState !== 'IDLE') return;
    const t = setInterval(() => {
      void (async () => {
        try {
          const st = await getPromptPayQRStatus(orderId);
          if (st.status === 'PAID') {
            setUnlocked([]);
            setUiState('SUCCESS');
            onSuccess?.([]);
          } else if (st.isExpired) {
            setUiState('EXPIRED');
          }
        } catch {
          // best-effort poll; countdown remains the source of truth
        }
      })();
    }, STATUS_POLL_MS);
    return () => clearInterval(t);
  }, [uiState, orderId, onSuccess]);

  const copy = async (kind: 'amount' | 'ref', value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(kind);
    setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
  };

  const pick = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError('กรุณาเลือกไฟล์ภาพ PNG, JPEG หรือ WebP');
      return;
    }
    if (file.size > MAX_SLIP_BYTES) {
      setError('ไฟล์สลิปต้องไม่เกิน 5 MB');
      return;
    }
    setError(null);
    setUiState('LOADING');
    try {
      const { slipImageUrl } = await uploadSlipImage(orderId, file);
      const result = await verifyPaymentSlip(orderId, slipImageUrl);
      setUnlocked(result.entitlementsGranted);
      setUiState('SUCCESS');
      onSuccess?.(result.entitlementsGranted);
    } catch (err) {
      setError((err as Error).message || 'เกิดข้อผิดพลาดในการตรวจสลิป');
      setUiState('IDLE');
    }
  };

  const accent = tenantColor ?? '#059669';

  if (uiState === 'LIFF_INIT') {
    return (
      <div className="p-6 bg-white rounded-2xl shadow-xl max-w-sm mx-auto" aria-busy="true">
        <div className="h-6 w-40 rounded bg-gray-100 animate-pulse mx-auto" />
        <div className="w-64 h-64 rounded-xl bg-gray-100 animate-pulse mx-auto mt-4" />
        <p className="mt-3 text-xs text-gray-400 text-center">กำลังสร้าง Dynamic PromptPay QR...</p>
      </div>
    );
  }

  if (uiState === 'SUCCESS') {
    return (
      <div className="flex flex-col items-center p-6 bg-white rounded-2xl shadow-xl max-w-sm mx-auto text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-3xl">✓</div>
        <h3 className="mt-3 text-lg font-bold text-gray-900">ชำระเงินสำเร็จ</h3>
        <p className="text-sm text-gray-500 mt-1">
          {unlocked.length > 0 ? `ปลดล็อกแล้ว ${unlocked.length} รายการ — เข้าถึงได้ทันที` : 'ตรวจพบการชำระเงินแล้ว — เข้าถึงได้ทันที'}
        </p>
        <a href="/library" className="mt-4 w-full py-3 text-white font-bold rounded-xl text-sm text-center" style={{ background: accent }}>
          เปิดอ่าน / เข้าเรียนทันที
        </a>
      </div>
    );
  }

  if (uiState === 'EXPIRED') {
    return (
      <div className="flex flex-col items-center p-6 bg-white rounded-2xl shadow-xl max-w-sm mx-auto text-center">
        {tenantLogo && <img src={tenantLogo} alt="" className="h-8 mb-2" />}
        <p className="text-red-500 font-bold">QR Code หมดอายุแล้ว</p>
        <p className="mt-1 text-xs text-gray-500">ยอดเศษสตางค์เดิมถูกคืนสู่ระบบแล้ว กดสร้างใหม่เพื่อรับยอดยืนยันตัวตนใหม่</p>
        {error && <p className="mt-2 text-xs text-red-500" role="alert">{error}</p>}
        <button
          type="button"
          onClick={() => void load(true)}
          className="mt-4 px-6 py-3 text-white font-medium rounded-xl transition w-full"
          style={{ background: accent }}
        >
          สร้าง QR Code ใหม่
        </button>
      </div>
    );
  }

  if (!qr) {
    return (
      <div className="p-6 bg-white rounded-2xl shadow-xl max-w-sm mx-auto text-center text-sm text-gray-500">
        กำลังสร้าง Dynamic PromptPay QR...
      </div>
    );
  }

  const mm = formatTime(left);

  return (
    <div
      className="flex flex-col items-center p-6 bg-white rounded-2xl shadow-xl max-w-sm mx-auto"
      style={{ ['--primary-color' as string]: accent }}
    >
      <div className="flex items-center gap-2 mb-1">
        {tenantLogo && <img src={tenantLogo} alt="" className="h-6" />}
        <h3 className="text-lg font-bold text-gray-900">สแกนชำระเงิน PromptPay</h3>
      </div>

      <div className="w-64 h-64 rounded-xl overflow-hidden mb-3 p-3 bg-white border-4" style={{ borderColor: accent }}>
        <QRCode value={qr.qrCodePayload} size={232} style={{ width: '100%', height: '100%' }} />
      </div>

      <div className="text-center">
        <p className="text-sm text-gray-500">ยอดชำระสุทธิ (รวมเศษสตางค์ยืนยันตัวตน)</p>
        <p className="text-3xl font-extrabold" style={{ color: accent }}>
          {qr.totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
        </p>
        <p className="text-xs text-amber-600 font-medium mt-1">
          * กรุณาโอนให้ตรงเศษสตางค์เพื่อให้ระบบอนุมัติอัตโนมัติภายใน 1 วินาที
        </p>
        <p className="text-[11px] text-gray-400 mt-1">Ref: {qr.reference1}</p>
      </div>

      <div className="mt-3 flex gap-2 w-full">
        <button
          type="button"
          onClick={() => void copy('amount', qr.totalAmount.toFixed(2))}
          className="flex-1 py-2 border rounded-xl text-xs font-medium text-gray-700"
        >
          {copied === 'amount' ? 'คัดลอกแล้ว ✓' : 'คัดลอกยอดเงิน'}
        </button>
        <button
          type="button"
          onClick={() => void copy('ref', qr.reference1)}
          className="flex-1 py-2 border rounded-xl text-xs font-medium text-gray-700"
        >
          {copied === 'ref' ? 'คัดลอกแล้ว ✓' : 'คัดลอก Ref'}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 bg-gray-100 px-4 py-2 rounded-full">
        <span className="text-xs text-gray-600">เวลาที่เหลือ:</span>
        <span className={`text-sm font-bold ${left < 120 ? 'text-red-500' : 'text-gray-800'}`}>{mm}</span>
      </div>

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uiState === 'LOADING' || left <= 0}
        className="mt-4 w-full text-white font-medium py-3 rounded-xl transition disabled:opacity-60"
        style={{ background: accent }}
      >
        {uiState === 'LOADING' ? 'กำลังตรวจสอบสลิปผ่าน EasySlip...' : 'อัปโหลดสลิปเพื่อปลดล็อกทันที'}
      </button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} disabled={uiState === 'LOADING'} className="hidden" />

      {error && (
        <div className="mt-3 p-3 bg-red-50 text-red-600 text-xs rounded-lg text-center w-full" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export default PromptPayQRWidget;
