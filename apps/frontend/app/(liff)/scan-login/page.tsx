// SSOT Phase 007 §6.1 — LIFF scan-login route (deep-link ?qrToken= &e= → scan → confirm drawer)
// Canonical: apps/frontend/app/(liff)/scan-login/page.tsx
// (legacy src/frontend/app/(liff)/scan-login/**)
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LiffAuthProvider, useLiffAuth } from '../../../providers/LiffAuthProvider';
import { QrCodeScanner, type QrScanStatus } from '../../../components/auth/qr-code-scanner';

function fingerprint(): string {
  try {
    const existing = localStorage.getItem('liff_device_fp');
    if (existing) return existing;
    const fp = `liff-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem('liff_device_fp', fp);
    return fp;
  } catch {
    return `liff-${Math.random().toString(36).slice(2)}`;
  }
}

function ScanLoginInner({ qrToken, envelope }: { qrToken: string; envelope: string | null }) {
  const { isAuthenticated, isLoading, getAccessToken, login } = useLiffAuth();
  const [status, setStatus] = useState<QrScanStatus>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [requirePin, setRequirePin] = useState(false);
  const scanned = useRef(false);

  useEffect(() => {
    if (isLoading || !isAuthenticated || scanned.current) return;
    scanned.current = true;
    const token = getAccessToken();
    if (!token) {
      setError('Missing LIFF session');
      return;
    }
    setStatus('CONFIRMING');
    fetch(`/auth/qr/${qrToken}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('QR scan rejected');
        setStatus('IDLE');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Scan failed');
        setStatus('ERROR');
      });
  }, [isLoading, isAuthenticated, qrToken, getAccessToken]);

  const confirm = useCallback(
    async (pin?: string) => {
      const token = getAccessToken();
      if (!token) {
        setError('Missing LIFF session');
        return;
      }
      setStatus('CONFIRMING');
      setError(null);
      try {
        const res = await fetch(`/auth/qr/${qrToken}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAccessToken: token,
            deviceFingerprint: fingerprint(),
            envelope,
            pin,
          }),
        });
        const body = (await res.json()) as { requirePin?: boolean; pin?: string; success?: boolean; message?: string };
        if (!res.ok) throw new Error(body.message ?? 'Confirm failed');
        if (body.requirePin) {
          setRequirePin(true);
          setStatus('IDLE');
          return;
        }
        setStatus('SUCCESS');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Confirm failed');
        setStatus('ERROR');
      }
    },
    [qrToken, envelope, getAccessToken],
  );

  const reject = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    await fetch(`/auth/qr/${qrToken}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token }),
    }).catch(() => undefined);
    setStatus('IDLE');
    setError('ปฏิเสธคำขอแล้ว');
  }, [qrToken, getAccessToken]);

  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-gray-500">กำลังยืนยันตัวตนปลอดภัยผ่าน LINE...</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-sm text-gray-600 mb-4">กรุณาเข้าสู่ระบบด้วย LINE ก่อนสแกน</p>
          <button
            onClick={login}
            className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg"
          >
            เข้าสู่ระบบด้วย LINE
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <QrCodeScanner
        qrToken={qrToken}
        requirePin={requirePin}
        serverPinHint={null}
        status={status}
        error={error}
        onConfirm={(pin) => void confirm(pin)}
        onReject={() => void reject()}
      />
    </main>
  );
}

export default function ScanLoginPage() {
  const [params, setParams] = useState<{ qrToken: string; envelope: string | null; tenant: string } | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const qrToken = q.get('qrToken') ?? '';
    if (!qrToken) {
      setParams(null);
      return;
    }
    setParams({ qrToken, envelope: q.get('e'), tenant: q.get('tenant') ?? 'default' });
  }, []);

  if (!params) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <p className="text-sm text-red-600">ลิงก์สแกนไม่ถูกต้อง (missing qrToken)</p>
      </main>
    );
  }

  const liffId = process.env.NEXT_PUBLIC_LINE_LIFF_ID ?? '';
  if (!liffId) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <p className="text-sm text-red-600">LIFF is not configured</p>
      </main>
    );
  }

  return (
    <LiffAuthProvider liffId={liffId} tenantId={params.tenant}>
      <ScanLoginInner qrToken={params.qrToken} envelope={params.envelope} />
    </LiffAuthProvider>
  );
}
