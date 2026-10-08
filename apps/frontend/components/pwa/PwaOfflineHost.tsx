// SSOT Phase 062 §6.1 — PwaOfflineHost (single SW + banner mount point)
// Canonical: apps/frontend/components/pwa/PwaOfflineHost.tsx
// - Null-render host: registers the SW once, flushes on mount when online,
//   and renders the OfflineIndicator (which self-nulls when online/idle).
// - Mounted once in the root layout → covers LIFF + Web segments.
// - Zero new deps.
'use client';

import { useEffect } from 'react';
import { initServiceWorker } from '../../lib/pwa/sw-register';
import { flushSyncQueue } from '../../lib/pwa/background-sync';
import { OfflineIndicator } from './offline-indicator';

export function PwaOfflineHost() {
  useEffect(() => {
    void initServiceWorker().then(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine) void flushSyncQueue();
    });
  }, []);
  return <OfflineIndicator />;
}

export default PwaOfflineHost;
