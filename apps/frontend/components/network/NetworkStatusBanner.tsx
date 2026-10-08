// SSOT Phase 069 Task 6 — NetworkStatusBanner (5-state alert, §2.2)
// Canonical: apps/frontend/components/network/NetworkStatusBanner.tsx
// (legacy src/frontend/components/network/NetworkStatusBanner.tsx)
// - RISK_CALL deviation: CSS translate3d transitions instead of
//   framer-motion (not installed; §2.1 RAM ≤1.5MB for this module).
// - SYNCING flush: POSTs queued actions, clears only server-acked ids,
//   bumps retryCount on failures; ONLINE toast shows 2.5s then slides up.
// - Safe-area aware (LIFF header) + tenant --primary-color accents.
// - Zero new deps.
'use client';

import { useEffect, useRef, useState } from 'react';
import { ONLINE_TOAST_MS, type NetworkStatusState } from '@repo/shared';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { bumpRetryCounts, getQueuedActions, removeQueuedActions } from '../../lib/offline-queue-db';

interface BannerConfig {
  bg: string;
  text: string;
  showRetry: boolean;
  showProgress: boolean;
}

function configFor(state: NetworkStatusState, latency: number, pending: number, done: number, total: number): BannerConfig | null {
  switch (state) {
    case 'OFFLINE_DISCONNECTED':
      return { bg: 'bg-red-600', text: 'ขาดการเชื่อมต่ออินเทอร์เน็ต - กำลังใช้งานในโหมดออฟไลน์', showRetry: true, showProgress: false };
    case 'NETWORK_DEGRADED':
      return { bg: 'bg-amber-500', text: `สัญญาณอินเทอร์เน็ตช้า (${latency}ms) - ข้อมูลอาจโหลดล่าช้า`, showRetry: false, showProgress: false };
    case 'RECONNECTING_PING':
      return { bg: 'bg-blue-600', text: 'กำลังตรวจสอบการเชื่อมต่อเครือข่ายใหม่...', showRetry: false, showProgress: false };
    case 'SYNCING_OFFLINE_QUEUE':
      return { bg: 'bg-indigo-600', text: `เชื่อมต่อแล้ว! กำลังซิงก์ข้อมูลออฟไลน์ (${done}/${total || pending} รายการ)...`, showRetry: false, showProgress: true };
    default:
      return null;
  }
}

export function NetworkStatusBanner() {
  const { networkState, latency, pendingQueueCount, refreshQueueCount, triggerManualCheck, setNetworkState } =
    useNetworkStatus();
  const [syncing, setSyncing] = useState(false);
  const [syncedCount, setSyncedCount] = useState(0);
  const [syncedTotal, setSyncedTotal] = useState(0);
  const [showOnlineToast, setShowOnlineToast] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineSince = useRef<number | null>(null);

  // §7.1 QoE telemetry: mark the start of each disconnection segment.
  useEffect(() => {
    if (networkState === 'OFFLINE_DISCONNECTED' && offlineSince.current === null) {
      offlineSince.current = Date.now();
    }
    if (networkState === 'ONLINE_STABLE') offlineSince.current = null;
  }, [networkState]);

  useEffect(() => {
    if (networkState !== 'SYNCING_OFFLINE_QUEUE' || syncing) return;
    let cancelled = false;
    const flush = async () => {
      setSyncing(true);
      let hadItems = false;
      try {
        const items = await getQueuedActions();
        if (cancelled) return;
        hadItems = items.length > 0;
        setSyncedTotal(items.length);
        if (items.length === 0) {
          setNetworkState('ONLINE_STABLE');
          return;
        }
        const res = await fetch('/api/v1/network/sync-offline-queue', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            items: items.map((i) => ({ id: i.id, actionType: i.actionType, payload: i.payload, createdAt: i.createdAt, retryCount: i.retryCount })),
          }),
        });
        const data = (await res.json().catch(() => null)) as { processedCount?: number; failedItemIds?: string[] } | null;
        if (cancelled) return;
        if (res.ok && data) {
          const acked = items.map((i) => i.id).filter((id) => !(data.failedItemIds ?? []).includes(id));
          setSyncedCount(acked.length);
          await removeQueuedActions(acked);
          await bumpRetryCounts(data.failedItemIds ?? []);
          await refreshQueueCount();
        }
        // §7.1: report the disconnection segment (best-effort).
        if (offlineSince.current !== null) {
          const disconnectionSec = Math.round((Date.now() - offlineSince.current) / 1000);
          offlineSince.current = null;
          if (disconnectionSec >= 5) {
            fetch('/api/v1/network/telemetry', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ deviceType: 'WEB_LIFF', disconnectionSec, actionsQueued: items.length }),
            }).catch(() => undefined);
          }
        }
      } catch {
        // flush best-effort; rows stay queued for the next cycle
      } finally {
        if (!cancelled) {
          setSyncing(false);
          const remaining = (await getQueuedActions().catch(() => [])).length;
          if (remaining > 0) {
            // Honest state: failures stay visible (amber) until the next
            // online event / manual retry re-flushes the queue.
            setNetworkState('NETWORK_DEGRADED');
          } else {
            setNetworkState('ONLINE_STABLE');
            if (hadItems) setShowOnlineToast(true);
          }
        }
      }
    };
    void flush();
    return () => {
      cancelled = true;
    };
  }, [networkState, syncing, refreshQueueCount, setNetworkState]);

  useEffect(() => {
    if (!showOnlineToast) return;
    toastTimer.current = setTimeout(() => setShowOnlineToast(false), ONLINE_TOAST_MS);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [showOnlineToast]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  if (networkState === 'ONLINE_STABLE' && pendingQueueCount === 0) {
    if (!showOnlineToast) return null;
    return (
      <div
        className="fixed left-0 right-0 top-0 z-[9999] flex items-center justify-between bg-emerald-600 px-4 py-2 text-xs font-medium text-white shadow-md transition-transform duration-300"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)', transform: 'translate3d(0,0,0)' }}
        role="status"
      >
        <span className="mx-auto">เชื่อมต่อแล้ว — ซิงก์ข้อมูลเรียบร้อย</span>
      </div>
    );
  }

  const config = configFor(networkState, latency, pendingQueueCount, syncedCount, syncedTotal);
  if (!config) return null;

  return (
    <div
      className={`fixed left-0 right-0 top-0 z-[9999] flex items-center justify-between px-4 py-2 text-xs font-medium text-white shadow-md transition-transform duration-300 ${config.bg}`}
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)', transform: 'translate3d(0,0,0)' }}
      role="alert"
    >
      <div className="mx-auto flex items-center gap-2 sm:mx-0">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
        </span>
        <span>{config.text}</span>
        {config.showProgress && syncedTotal > 0 && (
          <span className="h-1 w-24 overflow-hidden rounded-full bg-white/30">
            <span className="block h-full bg-white transition-all" style={{ width: `${Math.round((syncedCount / syncedTotal) * 100)}%` }} />
          </span>
        )}
      </div>
      {config.showRetry && (
        <button
          type="button"
          onClick={() => triggerManualCheck()}
          className="ml-3 rounded bg-white/20 px-2 py-0.5 text-[10px] underline transition-all hover:bg-white/30"
        >
          ลองเชื่อมต่อใหม่
        </button>
      )}
    </div>
  );
}

export default NetworkStatusBanner;
