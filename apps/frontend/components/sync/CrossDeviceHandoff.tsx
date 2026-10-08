// SSOT Phase 070 Task 5-7 — CrossDeviceHandoff (reader integration host)
// Canonical: apps/frontend/components/sync/CrossDeviceHandoff.tsx
// - Activates the SSE handoff only when an identity exists (post-handshake
//   localStorage or explicit userId prop); otherwise renders nothing.
// - Pushes local page turns (caller-driven via `position` prop) and offers
//   the toast jump on external moves (BDD-1/2 <500ms edge path).
// - LIFF scan button consumes a desktop QR token (BDD-4 guard enforced
//   server-side with DEVICE_LIMIT).
// - Zero new deps.
'use client';

import { useEffect, useRef } from 'react';
import { useCrossDeviceSync, type ExternalPosition } from '../../hooks/useCrossDeviceSync';
import { CrossDeviceSyncToast } from './CrossDeviceSyncToast';
import { authorizeHandshake, loadHandoff, saveHandoff, scanHandshakeToken } from '../../lib/cross-device/handshake-client';
import type { CrossDeviceContentType, DeviceType } from '@repo/shared';

interface CrossDeviceHandoffProps {
  productId: string;
  contentType: CrossDeviceContentType;
  contentId: string;
  deviceType: DeviceType;
  userId?: string | null;
  position: { pageNumber?: number; watchedSec?: number };
  onJump: (pos: ExternalPosition) => void;
  enableScan?: boolean;
}

export function CrossDeviceHandoff({
  productId, contentType, contentId, deviceType, userId: userIdProp, position, onJump, enableScan = false,
}: CrossDeviceHandoffProps) {
  const stored = typeof window !== 'undefined' ? loadHandoff() : null;
  const userId = userIdProp ?? stored?.userId ?? '';
  const { external, pushPosition, dismissExternal, isSynced } = useCrossDeviceSync({
    userId, productId, contentType, contentId, deviceType, enabled: userId.length > 0,
  });
  const lastPushed = useRef('');

  useEffect(() => {
    if (!userId) return;
    const key = `${position.pageNumber ?? '-'}.${position.watchedSec ?? '-'}`;
    if (key === lastPushed.current) return;
    lastPushed.current = key;
    const t = setTimeout(() => void pushPosition(position), 800);
    return () => clearTimeout(t);
  }, [userId, position.pageNumber, position.watchedSec, pushPosition]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!userId) return null;

  const confirm = () => {
    if (external) {
      // BDD-4: entering the foreign position pauses this viewport's stream;
      // the reader unmounts its player via onJump (memory-safe handoff).
      onJump(external);
      if (stored && external) {
        saveHandoff({ ...stored, at: Date.now() });
      }
    }
    dismissExternal();
  };

  const scan = async () => {
    const token = await scanHandshakeToken();
    if (!token) return;
    try {
      const res = await authorizeHandshake(token, `liff-${Date.now().toString(36)}`);
      saveHandoff({ userId, sessionFingerprint: res.sessionFingerprint, at: Date.now() });
    } catch {
      // DEVICE_LIMIT / consumed token surfaces via the next error state
    }
  };

  return (
    <>
      {isSynced && (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-600" role="status">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          เชื่อมต่อข้ามอุปกรณ์แล้ว
        </span>
      )}
      {enableScan && (
        <button type="button" onClick={() => void scan()} className="min-h-[44px] rounded-md border border-border px-3 text-xs">
          สแกน QR เชื่อมอุปกรณ์
        </button>
      )}
      {external && (
        <CrossDeviceSyncToast
          sourceDevice={external.sourceDevice}
          targetPage={external.pageNumber}
          targetSec={external.watchedSec}
          onConfirm={confirm}
          onDismiss={dismissExternal}
        />
      )}
    </>
  );
}

export default CrossDeviceHandoff;
