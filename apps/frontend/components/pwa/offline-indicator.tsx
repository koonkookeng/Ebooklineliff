// SSOT Phase 062 §2.1/§2.2 — OfflineIndicator (top-bar offline banner)
// Canonical: apps/frontend/components/pwa/offline-indicator.tsx
// (legacy src/frontend/components/pwa/offline-indicator.tsx)
// - 5 states from sw-register + navigator.onLine: LIFF_INIT (probe tick) →
//   IDLE (online) / LOADING (flushing queue) → SUCCESS (synced badge) /
//   ERROR (offline banner + "downloaded" shortcut).
// - Multi-tenant accent via --primary-color. Zero new deps.
'use client';

import { useEffect, useState } from 'react';
import { getSwStatus, initServiceWorker, subscribeSwStatus, type SwRegistrationState } from '../../lib/pwa/sw-register';
import { flushSyncQueue } from '../../lib/pwa/background-sync';

export function OfflineIndicator() {
  const [sw, setSw] = useState<SwRegistrationState>(() =>
    typeof window === 'undefined' ? 'LIFF_INIT' : getSwStatus().state,
  );
  const [online, setOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [flushing, setFlushing] = useState(false);

  useEffect(() => {
    void initServiceWorker();
    const unsub = subscribeSwStatus((s) => setSw(s.state));
    const on = () => {
      setOnline(true);
      setFlushing(true);
      flushSyncQueue()
        .catch(() => undefined)
        .finally(() => setFlushing(false));
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      unsub();
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (sw === 'LIFF_INIT') {
    return (
      <div className="flex items-center justify-center bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground" aria-busy>
        <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-slate-400" />
        กำลังตรวจสอบโหมดออฟไลน์…
      </div>
    );
  }

  if (!online) {
    return (
      <div role="alert" className="flex items-center justify-center gap-2 bg-amber-500/90 px-3 py-1.5 text-[11px] font-medium text-black">
        <span aria-hidden>📴</span>
        ออฟไลน์ — กำลังอ่านจากแคช
        <a href="/library" className="rounded-full bg-black/80 px-2 py-0.5 text-[10px] text-white">
          รายการที่ดาวน์โหลดไว้
        </a>
      </div>
    );
  }

  if (flushing) {
    return (
      <div className="flex items-center justify-center bg-sky-500/20 px-3 py-1 text-[11px] text-sky-200" aria-busy>
        กำลังซิงก์ความคืบหน้า…
      </div>
    );
  }

  return null;
}

export default OfflineIndicator;
