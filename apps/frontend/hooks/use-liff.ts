// SSOT Phase 021 §6.1 — Custom Hook: useLiff (Next.js 15 Client Hook)
// Canonical: apps/frontend/hooks/use-liff.ts
// (legacy src/frontend/hooks/use-liff.ts)
// - Dynamic import to avoid SSR issues (ssr:false equivalent)
// - Non-blocking async init, 3s timeout, max 2 retries (§10.2)
// - Mock fallback for external browser / desktop (§1.3 scenario 3)
// - Auto handshake POST /api/v1/auth/liff/verify (<800ms target)
// - Memory-only token refs, never localStorage (§8.1)
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Liff } from '@line/liff';

export type LiffEnvironment = 'LINE_IN_APP' | 'LINE_MINI_APP_SUBWINDOW' | 'EXTERNAL_BROWSER' | 'DESKTOP_MOCK';

interface UseLiffOptions {
  liffId: string;
  tenantId: string;
  autoAuth?: boolean;
}

interface UseLiffReturn {
  liff: Liff | null;
  isReady: boolean;
  error: string | null;
  isSubWindow: boolean;
  environment: LiffEnvironment;
  appLanguage: string | undefined;
  login: () => void;
  logout: () => void;
  retry: () => void;
}

const INIT_TIMEOUT_MS = 3000;
const MAX_RETRIES = 2;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

export function useLiff({ liffId, tenantId, autoAuth = true }: UseLiffOptions): UseLiffReturn {
  const [liffObject, setLiffObject] = useState<Liff | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubWindow, setIsSubWindow] = useState(false);
  const [environment, setEnvironment] = useState<LiffEnvironment>('EXTERNAL_BROWSER');
  const [appLanguage, setAppLanguage] = useState<string | undefined>(undefined);
  const [retryNonce, setRetryNonce] = useState(0);
  const mountedRef = useRef(true);

  const detectEnvironment = useCallback((sdk: Liff): LiffEnvironment => {
    try {
      if (typeof sdk.isSubWindow === 'function' && sdk.isSubWindow()) return 'LINE_MINI_APP_SUBWINDOW';
    } catch { /* ignore — pre-init SDK */ }
    try {
      if (typeof sdk.isInClient === 'function' && sdk.isInClient()) return 'LINE_IN_APP';
    } catch { /* ignore */ }
    if (typeof window === 'undefined') return 'DESKTOP_MOCK';
    return 'EXTERNAL_BROWSER';
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const boot = async () => {
      setError(null);
      setIsReady(false);
      let lastErr: unknown = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          // Dynamic import to avoid SSR issues
          const liffModule = (await import('@line/liff')).default as unknown as Liff;
          await withTimeout(liffModule.init({ liffId }), INIT_TIMEOUT_MS, 'LIFF init timeout');
          if (cancelled || !mountedRef.current) return;

          setLiffObject(liffModule);
          const env = detectEnvironment(liffModule);
          setEnvironment(env);
          try {
            setIsSubWindow(typeof liffModule.isSubWindow === 'function' ? liffModule.isSubWindow() : false);
          } catch {
            setIsSubWindow(false);
          }
          try {
            setAppLanguage(typeof liffModule.getAppLanguage === 'function' ? liffModule.getAppLanguage() : undefined);
          } catch {
            setAppLanguage(undefined);
          }
          setIsReady(true);

          // Auto Authentication Handshake (memory-only, no persistence)
          if (autoAuth && liffModule.isLoggedIn()) {
            const idToken = liffModule.getIDToken();
            if (idToken) {
              try {
                await withTimeout(
                  fetch('/api/v1/auth/liff/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idToken, tenantId }),
                  }),
                  INIT_TIMEOUT_MS,
                  'LIFF handshake timeout',
                );
              } catch {
                // Handshake failure must not crash init — surface via error toast by consumer.
              }
            }
          }
          return;
        } catch (err) {
          lastErr = err;
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      }

      // All retries exhausted → safe Mock fallback (external browser / desktop)
      if (!cancelled && mountedRef.current) {
        const msg = lastErr instanceof Error ? lastErr.message : 'Failed to initialize LINE LIFF';
        setError(msg);
        setIsReady(false);
        setEnvironment(typeof window === 'undefined' ? 'DESKTOP_MOCK' : 'EXTERNAL_BROWSER');
      }
    };

    void boot();
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [liffId, tenantId, autoAuth, retryNonce, detectEnvironment]);

  // Re-arm effect on unmount/remount (StrictMode safe)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const login = useCallback(() => {
    if (liffObject && !liffObject.isLoggedIn()) {
      liffObject.login();
    }
  }, [liffObject]);

  const logout = useCallback(() => {
    if (liffObject && liffObject.isLoggedIn()) {
      liffObject.logout();
      window.location.reload();
    }
  }, [liffObject]);

  const retry = useCallback(() => {
    setRetryNonce((n) => n + 1);
  }, []);

  return { liff: liffObject, isReady, error, isSubWindow, environment, appLanguage, login, logout, retry };
}

export default useLiff;
