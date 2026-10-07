// SSOT Phase 031 Task 2/§6.1 — KeepAliveProvider (vault + visibility machine)
// Canonical: apps/frontend/components/keep-alive/KeepAliveProvider.tsx
// (legacy src/frontend/components/keep-alive/KeepAliveProvider.tsx)
// - Owns the 5-state broadcast (LIFF_INIT → ACTIVE ⇄ BACKGROUND_PRESERVED →
//   HYDRATING → ACTIVE; ERROR_FALLBACK when a resume finds no local snapshot
//   and must consult the server) plus the vault/mirror primitives.
// - Native IndexedDB (no `idb` dep — zero-new-deps, Gate 5); components persist
//   via useViewportKeepAlive (per-viewport snapshot/release/rehydrate).
// - Server sync helpers are exposed for background flush + fallback restore;
//   identity binds server-side from the JWT cookie (Gate 4).
// - Null-visual provider (context only, zero DOM/RAM cost beyond the vault).
'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { KeepAliveStatus, ViewportType } from '@repo/shared';
import {
  clearViewportState,
  loadViewportState,
  restoreViewportServer,
  saveViewportState,
  syncViewportServer,
  type ServerSyncInput,
} from '../../lib/keep-alive/keep-alive-client';

export interface KeepAliveContextType {
  status: KeepAliveStatus;
  saveViewState: (viewportType: ViewportType, resourceId: string, data: unknown) => Promise<void>;
  loadViewState: <T = unknown>(viewportType: ViewportType, resourceId: string) => Promise<T | null>;
  clearViewState: (viewportType: ViewportType, resourceId: string) => Promise<void>;
  syncServer: (input: ServerSyncInput) => Promise<boolean>;
  restoreServer: (tenantId: string, viewportType: ViewportType) => Promise<unknown | null>;
  lastRehydrateMs: number | null;
}

const KeepAliveContext = createContext<KeepAliveContextType | null>(null);

export function KeepAliveProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<KeepAliveStatus>('LIFF_INIT');
  const [lastRehydrateMs, setLastRehydrateMs] = useState<number | null>(null);
  const statusRef = useRef<KeepAliveStatus>('LIFF_INIT');
  const hydratingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = useCallback((s: KeepAliveStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const saveViewState = useCallback(async (viewportType: ViewportType, resourceId: string, data: unknown) => {
    await saveViewportState(viewportType, resourceId, data);
  }, []);

  const loadViewState = useCallback(async <T = unknown>(viewportType: ViewportType, resourceId: string): Promise<T | null> => {
    return loadViewportState<T>(viewportType, resourceId);
  }, []);

  const clearViewState = useCallback(async (viewportType: ViewportType, resourceId: string) => {
    await clearViewportState(viewportType, resourceId);
  }, []);

  const syncServer = useCallback(async (input: ServerSyncInput): Promise<boolean> => {
    const out = await syncViewportServer(input);
    return out?.success === true;
  }, []);

  const restoreServer = useCallback(async (tenantId: string, viewportType: ViewportType): Promise<unknown | null> => {
    const out = await restoreViewportServer(tenantId, viewportType);
    if (!out.success) {
      set('ERROR_FALLBACK');
      return null;
    }
    return out.stateJson;
  }, [set]);

  // Visibility machine: ACTIVE ⇄ BACKGROUND_PRESERVED → HYDRATING → ACTIVE.
  // The 2s foreground snapshot cadence lives in useViewportKeepAlive (per
  // viewport); the provider only broadcasts + short HYDRATING settle window.
  useEffect(() => {
    set('ACTIVE');
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (hydratingTimer.current) clearTimeout(hydratingTimer.current);
        set('BACKGROUND_PRESERVED');
        return;
      }
      set('HYDRATING');
      const start = Date.now();
      if (hydratingTimer.current) clearTimeout(hydratingTimer.current);
      hydratingTimer.current = setTimeout(() => {
        setLastRehydrateMs(Date.now() - start);
        if (statusRef.current === 'HYDRATING') set('ACTIVE');
      }, 120);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (hydratingTimer.current) clearTimeout(hydratingTimer.current);
    };
  }, [set]);

  const value: KeepAliveContextType = {
    status,
    saveViewState,
    loadViewState,
    clearViewState,
    syncServer,
    restoreServer,
    lastRehydrateMs,
  };
  return <KeepAliveContext.Provider value={value}>{children}</KeepAliveContext.Provider>;
}

export function useKeepAliveContext(): KeepAliveContextType {
  const ctx = useContext(KeepAliveContext);
  if (!ctx) throw new Error('useKeepAlive must be used within KeepAliveProvider');
  return ctx;
}

export default KeepAliveProvider;
