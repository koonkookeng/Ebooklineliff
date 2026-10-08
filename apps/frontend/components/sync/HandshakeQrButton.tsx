// SSOT Phase 070 Task 4 — HandshakeQrButton (desktop QR issuer)
// Canonical: apps/frontend/components/sync/HandshakeQrButton.tsx
// - Desktop (web) mints a 120s one-time token and renders it with
//   react-qr-code (existing dep, Phase 007 precedent).
// - Zero new deps.
'use client';

import { useState } from 'react';
import QRCode from 'react-qr-code';
import { issueHandshakeQr } from '../../lib/cross-device/handshake-client';

export function HandshakeQrButton({ productId }: { productId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      const redirect = `${window.location.origin}/reader/${productId}?handoff=1`;
      const res = await issueHandshakeQr(redirect);
      setToken(res.handshakeToken);
      setExpiresAt(res.expiresAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ออก QR ล้มเหลว');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => void issue()}
        disabled={busy}
        className="min-h-[44px] rounded-md border border-border px-3 text-xs disabled:opacity-50"
      >
        {busy ? 'กำลังออก QR...' : 'ส่งต่อไปมือถือ (QR)'}
      </button>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      {token && (
        <div className="mt-2 rounded-lg border border-border bg-white p-3" role="dialog" aria-label="QR เชื่อมอุปกรณ์">
          <QRCode value={token} size={160} />
          <p className="mt-1 text-[11px] text-slate-500">สแกนด้วย LINE LIFF ภายใน 120 วินาที (ใช้ครั้งเดียว)</p>
          {expiresAt && <p className="text-[11px] text-slate-400">หมดอายุ {new Date(expiresAt).toLocaleTimeString('th-TH')}</p>}
        </div>
      )}
    </div>
  );
}

export default HandshakeQrButton;
