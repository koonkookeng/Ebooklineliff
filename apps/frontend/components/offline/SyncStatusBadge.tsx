// SSOT Phase 064 Task 6 — SyncStatusBadge (top-bar indicator)
// Canonical: apps/frontend/components/offline/SyncStatusBadge.tsx
// (legacy src/frontend/components/offline/SyncStatusBadge.tsx)
// - 5 states: LIFF_INIT (probing SW) → IDLE (synced) / LOADING
//   (flushing queue) → SUCCESS (toast + green) / ERROR (retry button).
// - Reads pending count from indexeddb-queue + BroadcastChannel for
//   SYNC_COMPLETED notifications (062/063 bg managers). Zero new deps.
'use client';

import { useEffect, useState } from 'react';
import { getPendingSyncCount } from '../../lib/offline/indexeddb-queue';
import { flushProgressQueue, registerProgressSync } from '../../lib/offline/background-sync-manager';

type BadgeState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export function SyncStatusBadge() {
  const [state, setState] = useState<BadgeState>('LIFF_INIT');
  const [count, setCount] = useState(0);

  useEffect(() => {
    registerProgressSync();
    getPendingSyncCount().then(setCount);
    const unsub = (typeof BroadcastChannel !== 'undefined') ? (() => {
      const ch = new BroadcastChannel('offline-sync-channel');
      ch.onmessage = (e) => {
        if (e.data?.type === 'SYNC_COMPLETED') {
          getPendingSyncCount().then(setCount);
          setState('SUCCESS');
          setTimeout(() => setState('IDLE'), 3000);
        }
      };
      return () => ch.close();
    }) : (() => {});

    const online = () => {
      setState('LOADING');
      void flushProgressQueue();
    };
    const offline = () => setState('ERROR');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    getPendingSyncCount().then((n) => {
      setCount(n);
      setState(n > 0 && !navigator.onLine ? 'ERROR' : navigator.onLine ? 'IDLE' : 'ERROR');
    });

    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      unsub();
    };
  }, []);

  if (state === 'LIFF_INIT') {
    return (
      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] text-muted-foreground" aria-busy>
        <span className="h-2 w-2 rounded-full bg-slate-400 animate-pulse" />
        <span>Syncing...</span>
      </div>
    );
  }

  if (state === 'LOADING') {
    return (
      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/20 text-[11px] text-sky-200" aria-busy>
        <span className="h-2 w-2 animate-spin rounded-full border-t-2 border-sky-500" />
        <span>Syncing {count} item(s)...</span>
      </div>
    );
  }

  if (state === 'SUCCESS') {
    return (
      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-[11px] text-emerald-300">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <span>Synced</span>
      </div>
    );
  }

  if (state === 'ERROR') {
    return (
      <div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-amber-500/20 text-[11px] text-amber-300">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        <span>{count} unsynced</span>
        <button
          onClick={() => void flushProgressQueue()}
          className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] text-white hover:bg-amber-600"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-[11px] text-emerald-300">
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      <span>Synced</span>
    </div>
  );
}

export default SyncStatusBadge;