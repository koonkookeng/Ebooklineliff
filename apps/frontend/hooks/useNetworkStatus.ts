// SSOT Phase 069 Task 5 — useNetworkStatus (5-state monitor + ping loop)
// Canonical: apps/frontend/hooks/useNetworkStatus.ts
// (legacy src/frontend/hooks/useNetworkStatus.ts)
// - Single owner of online/offline banner state (Zero Redundant Code §9:
//   no navigator.onLine checks outside this hook for banner purposes).
// - Ping: 2s abort timeout, 10s cadence, <300ms stable / >1500ms degraded.
//   Offline → online transitions ride RECONNECTING_PING → the banner flushes
//   the queue, then ONLINE_STABLE toast 2.5s.
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NETWORK_DEGRADED_MS,
  NETWORK_PING_CADENCE_MS,
  NETWORK_PING_TIMEOUT_MS,
  NETWORK_STABLE_MS,
  deriveNetworkState,
  type NetworkStatusState,
} from '@repo/shared';
import { getQueuedActions } from '../lib/offline-queue-db';

export type { NetworkStatusState };

export function useNetworkStatus(pingCadenceMs = NETWORK_PING_CADENCE_MS) {
  const [networkState, setNetworkState] = useState<NetworkStatusState>('ONLINE_STABLE');
  const [latency, setLatency] = useState(0);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const stateRef = useRef<NetworkStatusState>('ONLINE_STABLE');

  const setState = useCallback((s: NetworkStatusState) => {
    stateRef.current = s;
    setNetworkState(s);
  }, []);

  const refreshQueueCount = useCallback(async () => {
    try {
      const items = await getQueuedActions();
      setPendingQueueCount(items.length);
    } catch {
      // count best-effort
    }
  }, []);

  const performPingCheck = useCallback(async (announce = false) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setState('OFFLINE_DISCONNECTED');
      return;
    }
    const start = performance.now();
    const prev = stateRef.current;
    // Event-driven checks (online event / manual retry) announce the blue
    // RECONNECTING state; silent cadence ticks derive straight through so
    // the banner never flashes on a healthy connection.
    if (announce && (prev === 'ONLINE_STABLE' || prev === 'NETWORK_DEGRADED')) setState('RECONNECTING_PING');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), NETWORK_PING_TIMEOUT_MS);
      const res = await fetch('/api/v1/network/ping', { method: 'GET', cache: 'no-store', signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) {
        setState('OFFLINE_DISCONNECTED');
        return;
      }
      const roundTripMs = Math.round(performance.now() - start);
      setLatency(roundTripMs);
      if (roundTripMs > NETWORK_DEGRADED_MS) {
        setState('NETWORK_DEGRADED');
      } else if (prev === 'OFFLINE_DISCONNECTED' || prev === 'RECONNECTING_PING' || prev === 'NETWORK_DEGRADED') {
        // Recovery path: banner flushes the queue, then stabilizes.
        setState(roundTripMs < NETWORK_STABLE_MS ? 'SYNCING_OFFLINE_QUEUE' : 'NETWORK_DEGRADED');
      } else {
        setState('ONLINE_STABLE');
      }
    } catch {
      setState('OFFLINE_DISCONNECTED');
    }
  }, [setState]);

  useEffect(() => {
    void refreshQueueCount();
    void performPingCheck(false);
    const handleOnline = () => {
      setState('RECONNECTING_PING');
      void performPingCheck(true);
    };
    const handleOffline = () => setState('OFFLINE_DISCONNECTED');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    const timer = setInterval(() => void performPingCheck(false), pingCadenceMs);
    const counter = setInterval(() => void refreshQueueCount(), pingCadenceMs);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(timer);
      clearInterval(counter);
    };
  }, [performPingCheck, refreshQueueCount, pingCadenceMs]);

  const triggerManualCheck = useCallback(() => performPingCheck(true), [performPingCheck]);

  return { networkState, latency, pendingQueueCount, refreshQueueCount, triggerManualCheck, setNetworkState: setState };
}

export default useNetworkStatus;
