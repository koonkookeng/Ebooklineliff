// SSOT Phase 033 Task 3/§6.1 — AutoUpdateChecker (cold-start + visible re-check)
// Canonical: apps/frontend/components/updater/AutoUpdateChecker.tsx
// (legacy src/frontend/components/updater/AutoUpdateChecker.tsx)
// - BDD Scenario 1: background check on mount (<100ms edge path); mismatch →
//   FORCE_IMMEDIATE gets the blocking overlay, RECOMMENDED gets the gentle
//   toast with “อัปเดตทันที”, OPTIONAL stays silent (IDLE).
// - Mid-session releases are caught by re-checking on visibility visible
//   (SSE-consumer-ready: a VERSION_RELEASED push can call the same apply path).
// - Purge order: loop-guard → SW unregister → cache clear → ?_v= reload;
//   keep-alive state already lives in IndexedDB (Phase 031), so the reload
//   rehydrates within budget. Failures fall back to the local version (§2.2).
// - Null-render when current (IDLE) — zero DOM/RAM cost in steady state.
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { VersionCheckResponse } from '@repo/shared';
import {
  cacheBustedUrl,
  canAutoReload,
  checkForUpdate,
  clearAllCaches,
  purgeServiceWorkers,
  recordAutoReload,
  resetAutoReload,
} from '../../lib/updater/update-client';
import { registerUpdateChannel } from '../../service-workers/sw-update-handler';

export type UpdateUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface AutoUpdateCheckerProps {
  currentVersion: string;
  currentBuildHash: string;
}

function tenantOf(search: URLSearchParams): string {
  return search.get('tenant') ?? 'default';
}

export function AutoUpdateChecker({ currentVersion, currentBuildHash }: AutoUpdateCheckerProps) {
  const params = useSearchParams();
  const [uiState, setUiState] = useState<UpdateUiState>('LIFF_INIT');
  const [pending, setPending] = useState<VersionCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkingRef = useRef(false);

  const applyUpdate = useCallback(async (buildHash: string) => {
    if (!canAutoReload()) {
      setUiState('ERROR');
      setError('ตรวจพบการอัปเดตซ้ำ ใช้งานเวอร์ชันปัจจุบันต่อเพื่อความปลอดภัย');
      return;
    }
    setUiState('LOADING');
    recordAutoReload();
    await purgeServiceWorkers();
    await clearAllCaches();
    setUiState('SUCCESS');
    if (typeof window !== 'undefined') window.location.href = cacheBustedUrl(window.location.href, buildHash);
  }, []);

  const check = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const res = await checkForUpdate({
        tenantId: tenantOf(params),
        clientVersion: currentVersion,
        clientBuildHash: currentBuildHash,
        platform: 'LINE_LIFF',
      });
      if (!res) {
        setUiState('ERROR');
        setError('ตรวจสอบเวอร์ชันไม่สำเร็จ ใช้งานเวอร์ชันปัจจุบันต่อ');
        return;
      }
      if (res.isLatest) {
        resetAutoReload();
        setPending(null);
        setUiState('IDLE');
        return;
      }
      setPending(res);
      setUiState(res.needsForceUpdate ? 'LOADING' : 'IDLE');
      if (res.needsForceUpdate) void applyUpdate(res.latestBuildHash);
    } finally {
      checkingRef.current = false;
    }
  }, [params, currentVersion, currentBuildHash, applyUpdate]);

  useEffect(() => {
    void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    // BDD Scenario 2 push path: VERSION_RELEASED reuses the same check/apply.
    const unregister = registerUpdateChannel(() => void check());
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      unregister();
    };
  }, [check]);

  if (uiState === 'LOADING' && pending?.needsForceUpdate) {
    return (
      <div role="alert" aria-busy="true" className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-slate-900/90 text-white">
        <div className="flex flex-col items-center gap-4 p-6 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-400 border-t-transparent" />
          <p className="text-lg font-semibold">พบเวอร์ชันสำคัญ กำลังอัปเดตระบบ...</p>
          <p className="text-xs text-slate-400">กรุณารอครู่เดียว ระบบกำลังโหลดข้อมูลใหม่</p>
        </div>
      </div>
    );
  }

  if (pending && !pending.isLatest && !pending.needsForceUpdate) {
    return (
      <div role="status" className="fixed inset-x-4 bottom-4 z-50 flex items-center justify-between gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-xl">
        <p className="text-sm">เวอร์ชันใหม่พร้อมใช้งานแล้ว ({pending.latestVersion})</p>
        <button
          type="button"
          onClick={() => pending && void applyUpdate(pending.latestBuildHash)}
          className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium"
        >
          อัปเดตทันที
        </button>
      </div>
    );
  }

  if (uiState === 'ERROR' && error) {
    return (
      <div role="status" className="sr-only">
        {error}
      </div>
    );
  }

  return null;
}

export default AutoUpdateChecker;
