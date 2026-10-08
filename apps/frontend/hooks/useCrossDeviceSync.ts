// SSOT Phase 070 Task 5 — useCrossDeviceSync (SSE handoff, no socket.io)
// Canonical: apps/frontend/hooks/useCrossDeviceSync.ts
// (legacy src/frontend/hooks/useCrossDeviceSync.ts)
// - TRANSPORT NOTE (ADR-057/070): socket.io-client is NOT installed.
//   Server→client rides EventSource (cross-device SSE room); client→
//   server rides POST /api/v1/sync/position (vector-clock guarded).
// - 5-state machine (§2.2): LIFF_INIT/WEB_HANDSHAKE → IDLE_SYNCED →
//   SYNC_PENDING → SUCCESS_TRANSITION → SYNC_ERROR_FALLBACK.
// - LIFF memory guard: EventSource closed on unmount; scalar-only frames.
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CrossDeviceContentType, DeviceType } from '@repo/shared';

export type CrossDeviceUiState =
  | 'LIFF_INIT'
  | 'IDLE_SYNCED'
  | 'SYNC_PENDING'
  | 'SUCCESS_TRANSITION'
  | 'SYNC_ERROR_FALLBACK';

export interface ExternalPosition {
  pageNumber?: number;
  watchedSec?: number;
  sourceDevice: string;
}

interface UseCrossDeviceSyncProps {
  userId: string;
  productId: string;
  contentType: CrossDeviceContentType;
  contentId: string;
  deviceType: DeviceType;
  enabled?: boolean;
}

export function useCrossDeviceSync({
  userId, productId, contentType, contentId, deviceType, enabled = true,
}: UseCrossDeviceSyncProps) {
  const [uiState, setUiState] = useState<CrossDeviceUiState>('LIFF_INIT');
  const [external, setExternal] = useState<ExternalPosition | null>(null);
  const [isSynced, setIsSynced] = useState(false);
  const clockRef = useRef(1);
  const sourceRef = useRef<EventSource | null>(null);
  const optsRef = useRef({ userId, productId, contentType, contentId, deviceType });
  optsRef.current = { userId, productId, contentType, contentId, deviceType };

  useEffect(() => {
    if (!enabled || !userId) {
      setUiState('SYNC_ERROR_FALLBACK');
      return;
    }
    setUiState('LIFF_INIT');
    // Adopt the latest edge clock so offline moves reconcile (BDD-3).
    fetch(`/api/v1/sync/position?productId=${encodeURIComponent(productId)}&contentType=${encodeURIComponent(contentType)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { vectorClock?: number } | null) => {
        if (data && Number.isInteger(data.vectorClock)) clockRef.current = Number(data.vectorClock);
        setUiState('IDLE_SYNCED');
        setIsSynced(true);
      })
      .catch(() => setUiState('IDLE_SYNCED'));

    const source = new EventSource(`/api/v1/sync/cross-device-stream?userId=${encodeURIComponent(userId)}`);
    sourceRef.current = source;
    source.onopen = () => {
      setIsSynced(true);
      setUiState((s) => (s === 'LIFF_INIT' ? 'IDLE_SYNCED' : s));
    };
    source.onerror = () => setIsSynced(false);
    source.onmessage = (e: MessageEvent) => {
      try {
        interface PositionFrame {
          productId?: string;
          sourceDevice?: string;
          positionMarker?: { pageNumber?: number; watchedSec?: number; vectorClock?: number };
        }
        const raw = JSON.parse(e.data as string) as { data?: PositionFrame } & PositionFrame;
        const d: PositionFrame = raw.data ?? raw;
        if (!d || d.productId !== optsRef.current.productId) return;
        if (d.sourceDevice === optsRef.current.deviceType) return;
        if (Number.isInteger(d.positionMarker?.vectorClock)) {
          clockRef.current = Math.max(clockRef.current, Number(d.positionMarker?.vectorClock));
        }
        setExternal({ pageNumber: d.positionMarker?.pageNumber, watchedSec: d.positionMarker?.watchedSec, sourceDevice: String(d.sourceDevice) });
        setUiState('SUCCESS_TRANSITION');
      } catch {
        // malformed frame never breaks the stream
      }
    };
    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [enabled, userId, productId, contentType]);

  const pushPosition = useCallback(async (position: { pageNumber?: number; watchedSec?: number }) => {
    const o = optsRef.current;
    clockRef.current += 1;
    setUiState('SYNC_PENDING');
    try {
      const res = await fetch('/api/v1/sync/position', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: o.userId, productId: o.productId, contentType: o.contentType, contentId: o.contentId,
          positionMarker: { ...position, vectorClock: clockRef.current },
          sourceDevice: o.deviceType, timestamp: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`sync ${res.status}`);
      setUiState('IDLE_SYNCED');
    } catch {
      setUiState('SYNC_ERROR_FALLBACK');
    }
  }, []);

  const dismissExternal = useCallback(() => {
    setExternal(null);
    setUiState('IDLE_SYNCED');
  }, []);

  return { uiState, isSynced, external, pushPosition, dismissExternal };
}

export default useCrossDeviceSync;
