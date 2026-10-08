// SSOT Phase 056 §6.1 — Viewport detection hook (LIFF context + capabilities)
// Canonical: apps/frontend/hooks/useViewportEnvironment.ts
// (legacy src/frontend/hooks/useViewportEnvironment.ts)
// - Detects LINE LIFF Webview (window.liff.isInClient, fail-open → Web),
//   classifies LINE_LIFF_MOBILE/LINE_LIFF_DESKTOP/WEB_MOBILE_PWA/
//   WEB_DESKTOP_WORKSPACE via the shared breakpoint, and assigns the strict
//   30MB LIFF RAM budget vs the Web budget. Re-evaluates on resize.
// - Zero new deps.
'use client';

import { useEffect, useState } from 'react';
import {
  VIEWPORT_LIFF_FALLBACK_MS,
  detectRuntimeEnvironment,
  ramBudgetFor,
  type ViewportCapabilities,
} from '@repo/shared';

export type ViewportUiState = 'LIFF_INIT' | 'VIEWPORT_DETECT' | 'HYDRATING' | 'ACTIVE_VIEW' | 'ERROR_FALLBACK';

interface LiffWindow {
  liff?: { isInClient?: () => boolean };
}

function readLiffFlag(): boolean {
  try {
    const w = window as unknown as LiffWindow;
    if (w.liff && typeof w.liff.isInClient === 'function') return w.liff.isInClient();
  } catch {
    // LIFF SDK unavailable — self-heal to Web Standard Viewport (§10)
  }
  return false;
}

export function useViewportEnvironment(): {
  capabilities: ViewportCapabilities | null;
  isLoading: boolean;
  uiState: ViewportUiState;
  error: string | null;
  retry: () => void;
} {
  const [capabilities, setCapabilities] = useState<ViewportCapabilities | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // LIFF SDK may inject late — bound the wait to the 500ms self-heal budget.
    const startedAt = Date.now();
    const detect = (): void => {
      try {
        const isLiff = readLiffFlag();
        const width = window.innerWidth;
        const height = window.innerHeight;
        const supportsTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const environment = detectRuntimeEnvironment(isLiff, width);
        if (cancelled) return;
        setCapabilities({
          environment,
          isLiff,
          screenWidth: width,
          screenHeight: height,
          devicePixelRatio: window.devicePixelRatio || 1,
          maxRamBudgetMB: ramBudgetFor(isLiff),
          supportsTouch,
        });
        setError(null);
        setIsLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Viewport detection failed');
        setIsLoading(false);
      }
    };
    const wait = Math.max(0, VIEWPORT_LIFF_FALLBACK_MS - (Date.now() - startedAt));
    const t = window.setTimeout(detect, wait);
    window.addEventListener('resize', detect);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      window.removeEventListener('resize', detect);
    };
  }, [nonce]);

  const uiState: ViewportUiState = isLoading
    ? 'VIEWPORT_DETECT'
    : error || !capabilities
      ? 'ERROR_FALLBACK'
      : 'ACTIVE_VIEW';

  return { capabilities, isLoading, uiState, error, retry: () => { setIsLoading(true); setNonce((n) => n + 1); } };
}

export default useViewportEnvironment;
