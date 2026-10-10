// SSOT Phase 119 §6.2 — trusted device manager (dep-free)
// Canonical: apps/frontend/components/security/device-manager.tsx
// - Lists bound devices (fragment-only fingerprints — full hashes never
//   leave the server) + per-device revoke (plan cap: 2).
// - Zero new deps (React only).
'use client';

import React from 'react';
import type { BoundDeviceView } from '../../lib/fingerprint/device-session-client';

export function DeviceManager(props: {
  devices: BoundDeviceView[];
  busy: boolean;
  onRevoke: (deviceId: string) => Promise<unknown>;
}) {
  const { devices, busy, onRevoke } = props;
  if (devices.length === 0) return <p>ยังไม่มีอุปกรณ์ที่ผูกไว้</p>;
  return (
    <ul>
      {devices.map((d) => (
        <li key={d.id} data-testid="device-row" data-trusted={d.isTrusted ? 'true' : 'false'}>
          <strong>{d.deviceName}</strong> · {d.deviceType} · {d.isTrusted ? 'TRUSTED' : 'UNTRUSTED'}
          <span> · {d.fingerprintFragment} · {d.lastIpAddress}</span>
          {' '}
          <button type="button" onClick={() => void onRevoke(d.id)} disabled={busy}>
            เลิกผูก
          </button>
        </li>
      ))}
    </ul>
  );
}
