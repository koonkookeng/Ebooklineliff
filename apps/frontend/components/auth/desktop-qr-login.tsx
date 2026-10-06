// SSOT Phase 007 §6.1 — desktop QR login container (GQL init + SSE + one-time complete + redirect)
// Canonical: apps/frontend/components/auth/desktop-qr-login.tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QrCodeDisplay, type QrDisplayStatus } from './qr-code-display';

type Flow = 'QR_INIT' | 'QR_PENDING' | 'QR_SCANNED' | 'SUCCESS' | 'EXPIRED' | 'ERROR';

const TO_DISPLAY: Record<Flow, QrDisplayStatus> = {
  QR_INIT: 'INIT',
  QR_PENDING: 'PENDING',
  QR_SCANNED: 'SCANNED',
  SUCCESS: 'SUCCESS',
  EXPIRED: 'EXPIRED',
  ERROR: 'ERROR',
};

function deviceFingerprint(): string {
  try {
    const existing = localStorage.getItem('qr_device_fp');
    if (existing) return existing;
    const fp = `fp-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem('qr_device_fp', fp);
    return fp;
  } catch {
    return `fp-${Math.random().toString(36).slice(2)}`;
  }
}

const LIFF_BASE =
  process.env.NEXT_PUBLIC_LIFF_URL_BASE ?? 'https://liff.line.me/144-XZ';

export function DesktopQrLogin({ tenantId }: { tenantId: string }) {
  const [flow, setFlow] = useState<Flow>('QR_INIT');
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(60);
  const [pinDisplay, setPinDisplay] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const doneRef = useRef(false);

  const cleanup = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const complete = useCallback(
    async (token: string, code: string) => {
      const res = await fetch(`/auth/qr/${token}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, deviceFingerprint: deviceFingerprint() }),
      });
      if (!res.ok) throw new Error('QR handoff failed');
      doneRef.current = true;
      setFlow('SUCCESS');
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 600);
    },
    [],
  );

  const boot = useCallback(async () => {
    doneRef.current = false;
    cleanup();
    setFlow('QR_INIT');
    try {
      const res = await fetch('/api/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query InitQr($tenantId: ID) { initQrLoginSession(tenantId: $tenantId) { qrToken encryptedNonce expiresInSec websocketChannel } }`,
          variables: { tenantId },
        }),
      });
      const body = (await res.json()) as {
        errors?: Array<{ message: string }>;
        data?: { initQrLoginSession: { qrToken: string; encryptedNonce: string; expiresInSec: number } };
      };
      if (body.errors?.length) throw new Error(body.errors[0].message);
      const session = body.data?.initQrLoginSession;
      if (!session) throw new Error('QR init failed');
      setQrToken(session.qrToken);
      setQrValue(
        `${LIFF_BASE}/scan-login?qrToken=${encodeURIComponent(session.qrToken)}&e=${encodeURIComponent(session.encryptedNonce)}&tenant=${encodeURIComponent(tenantId)}`,
      );
      setCountdown(session.expiresInSec);
      setFlow('QR_PENDING');

      const es = new EventSource(`/auth/qr/${session.qrToken}/stream`);
      esRef.current = es;
      es.addEventListener('status', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as {
            status?: string;
            oneTimeCode?: string;
            requirePin?: boolean;
            pinDisplay?: string;
          };
          if (data.status === 'SCANNED') {
            setFlow('QR_SCANNED');
            if (data.requirePin && data.pinDisplay) setPinDisplay(data.pinDisplay);
          } else if (data.status === 'AUTHORIZED' && data.oneTimeCode && !doneRef.current) {
            void complete(session.qrToken, data.oneTimeCode);
          } else if (data.status === 'REJECTED') {
            setFlow('ERROR');
            cleanup();
          } else if (data.status === 'EXPIRED') {
            setFlow('EXPIRED');
            cleanup();
          }
        } catch {
          // malformed SSE frame; countdown expiry still guards the session
        }
      });
      es.onerror = () => {
        if (!doneRef.current) {
          setFlow((f) => (f === 'QR_PENDING' || f === 'QR_SCANNED' ? 'ERROR' : f));
        }
      };
    } catch {
      setFlow('ERROR');
    }
  }, [tenantId, complete, cleanup]);

  useEffect(() => {
    void boot();
    return cleanup;
  }, [boot, cleanup]);

  useEffect(() => {
    if (flow !== 'QR_PENDING' && flow !== 'QR_SCANNED') return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setFlow('EXPIRED');
          cleanup();
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [flow, cleanup]);

  return (
    <QrCodeDisplay
      value={qrValue}
      status={TO_DISPLAY[flow]}
      countdownSec={countdown}
      pinDisplay={pinDisplay}
      onRefresh={() => void boot()}
    />
  );
}

export default DesktopQrLogin;
