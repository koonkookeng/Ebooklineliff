// SSOT Phase 119 §6.2 — concurrent-stream eviction modal (dep-free)
// Canonical: apps/frontend/components/security/device-eviction-modal.tsx
// - Non-blocking overlay: "พบการหารบัญชี/เปิดดูซ้อน" + [เตะอุปกรณ์อื่น]
//   + [ขอ OTP ยืนยัน]. Text glyphs only (bundle guard). Zero new deps.
'use client';

import React from 'react';

export function DeviceEvictionModal(props: {
  evictedDeviceId?: string;
  busy: boolean;
  error: string | null;
  onKickOther: () => Promise<unknown>;
  onRequestOtp: () => void;
  onClose: () => void;
}) {
  const { evictedDeviceId, busy, error, onKickOther, onRequestOtp, onClose } = props;
  return (
    <div role="alertdialog" aria-label="พบการเปิดดูซ้อน" data-testid="eviction-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 16, maxWidth: 360 }}>
        <h2>พบการหารบัญชี/เปิดดูซ้อน</h2>
        <p>
          บัญชีนี้กำลังรับชมอยู่บนอุปกรณ์อื่น{evictedDeviceId ? ` (${evictedDeviceId.slice(0, 8)})` : ''} การเล่นบนอุปกรณ์นี้ถูกหยุดชั่วคราว
        </p>
        {error && <p role="alert">{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => void onKickOther()} disabled={busy}>
            {busy ? 'กำลังเตะ…' : 'เตะอุปกรณ์อื่น'}
          </button>
          <button type="button" onClick={onRequestOtp}>
            ขอ OTP ยืนยัน
          </button>
          <button type="button" onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
