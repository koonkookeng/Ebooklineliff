// SSOT Phase 027 §6.1 — useLiffNavigation history interceptor + safe navigation
// Canonical: apps/frontend/hooks/use-liff-navigation.ts
// (legacy src/frontend/hooks/use-liff-navigation.ts)
// - Intercepts Browser History popstate (Android Back / iOS swipe) with priority:
//   1) close active Modal/Drawer (no route change), 2) dirty-state guard →
//   pendingExit (ExitConfirmDialog), 3) pop internal stack via router.back(),
//   4) root → pendingExit(CLOSE) → liff.closeWindow() on confirm.
// - safeNavigate pushes the internal stack BEFORE router.push so Back restores it.
// - 5 states: LIFF_INIT (shell probe) → IDLE → LOADING (confirm-exit sync) →
//   SUCCESS (navigated) / ERROR (soft toast, stay on page).
// - RAM guard: SDK via lib singleton (no static import in hotspot); no listeners
//   leak (cleanup on unmount); fire-and-forget session sync (≤32KB snapshot).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  closeModal,
  getNavigationSnapshot,
  popRoute,
  pushRoute,
  requestExit,
  setCanGoBack,
  setShellReady,
  setTenantContext,
  useNavigationStore,
} from '../stores/use-navigation-store';
import { getLiff } from '../lib/liff/liff-sdk';
import { sanitizeSensitiveState, syncNavigationSession } from '../lib/navigation/navigation-client';

export type LiffNavStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

async function closeLiffWindow(): Promise<void> {
  sanitizeSensitiveState();
  try {
    const liff = await getLiff();
    const closer = (liff as unknown as { closeWindow?: () => void }).closeWindow;
    if (typeof closer === 'function') {
      closer.call(liff);
      return;
    }
  } catch {
    // SDK unavailable (desktop preview): fall back to history close attempt.
  }
  try {
    window.close();
  } catch {
    // Non-script-opened window: stay on page (no throw).
  }
}

export function useLiffNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<LiffNavStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const mountedRef = useRef(true);

  const isModalOpen = useNavigationStore((s) => s.isModalOpen);
  const isDirtyState = useNavigationStore((s) => s.isDirtyState);
  const canGoBack = useNavigationStore((s) => s.canGoBack);
  const modalRef = useRef(isModalOpen);
  modalRef.current = isModalOpen;
  const dirtyRef = useRef(isDirtyState);
  dirtyRef.current = isDirtyState;

  // Shell probe + tenant context (LIFF_INIT → IDLE).
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const probe = async (): Promise<void> => {
      try {
        await getLiff();
      } catch {
        // External browser: shell still usable (close falls back to window.close).
      }
      if (cancelled || !mountedRef.current) return;
      const tenant = searchParams.get('tenant') ?? 'default';
      setTenantContext(tenant, pathnameRef.current);
      pushRoute(pathnameRef.current);
      setShellReady(true);
      setCanGoBack(false);
      setStatus('IDLE');
    };
    void probe();
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track in-app navigations into the internal stack.
  useEffect(() => {
    const snap = getNavigationSnapshot();
    if (snap.shellReady && snap.currentRoute !== pathname) pushRoute(pathname);
  }, [pathname]);

  // popstate interceptor (priority 1 → 4).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.history.pushState({ page: pathnameRef.current }, '', window.location.href);
    } catch {
      return;
    }
    const handlePopState = (): void => {
      // Priority 1: close modal/drawer first, keep URL.
      if (modalRef.current) {
        closeModal();
        try {
          window.history.pushState({ page: pathnameRef.current }, '', window.location.href);
        } catch {
          // ignore
        }
        return;
      }
      // Priority 2: dirty guard → exit confirmation (no close yet).
      if (dirtyRef.current) {
        requestExit('BACK');
        try {
          window.history.pushState({ page: pathnameRef.current }, '', window.location.href);
        } catch {
          // ignore
        }
        return;
      }
      // Priority 3: internal sub-stack pop.
      const hadPrevious = popRoute();
      if (hadPrevious) {
        setStatus('SUCCESS');
        router.back();
        return;
      }
      // Priority 4: root → close confirmation (provider dialog owns the action).
      requestExit('CLOSE');
      try {
        window.history.pushState({ page: pathnameRef.current }, '', window.location.href);
      } catch {
        // ignore
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [router]);

  const safeNavigate = useCallback(
    (targetUrl: string) => {
      pushRoute(pathnameRef.current);
      setStatus('IDLE');
      router.push(targetUrl);
    },
    [router],
  );

  /** Confirm a pending exit: persist snapshot to Redis, then Back or closeWindow. */
  const confirmExit = useCallback(async (identity: { userId: string; lineUserId: string }): Promise<boolean> => {
    setStatus('LOADING');
    setError(null);
    try {
      const snap = getNavigationSnapshot();
      const now = Date.now();
      const stateSnapshotJson = JSON.stringify({
        tenantId: snap.tenantId,
        currentRoute: pathnameRef.current,
        canGoBack: snap.canGoBack,
        stackDepth: Math.max(snap.historyStack.length, 1),
        isModalOpen: false,
        activeModalId: null,
        isDirtyState: snap.isDirtyState,
        historyStack: snap.historyStack.map((p) => ({
          // uuid-required by NavigationStackItemSchema (save 400s otherwise).
          id: newStackId(),
          pathname: p,
          searchParams: {},
          timestamp: now,
          isDirty: snap.isDirtyState,
        })),
      });
      const saved = await syncNavigationSession({
        userId: identity.userId,
        lineUserId: identity.lineUserId,
        lastPathname: pathnameRef.current,
        stateSnapshotJson,
      });
      void saved;
      const pending = getNavigationSnapshot().pendingExit;
      if (!pending || pending.kind === 'CLOSE') {
        await closeLiffWindow();
      } else {
        popRoute();
        router.back();
      }
      setStatus('SUCCESS');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Exit failed');
      setStatus('ERROR');
      return false;
    }
  }, [router]);

  return { status, error, safeNavigate, confirmExit, closeLiffWindow, canGoBack };
}

/** uuid v4 for stack items (WebCrypto + deterministic valid-uuid fallback). */
function newStackId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Fall through to offline-safe fallback below.
  }
  const tail = Date.now().toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${tail}`;
}
