// SSOT Phase 022 §2.2 — SafeAreaProvider (5-state machine, tenant-aware)
// Canonical: apps/frontend/providers/SafeAreaProvider.tsx
// (legacy src/frontend/providers/SafeAreaProvider.tsx)
// States: ENV_DETECTING → LIFF_NATIVE_VIEW | STANDALONE_PWA | MOBILE_WEBVIEW | DESKTOP_BROWSER
// - Skeleton spacers during ENV_DETECTING prevent layout shift
// - Includes §10.5 self-healing layout check (dynamic --sab compensation)
'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useEnvironmentDetection } from '../hooks/useEnvironmentDetection';
import type { ViewportMetrics, LayoutMode } from '@repo/shared';
import '../styles/safe-area.css';

export type SafeAreaState =
  | 'ENV_DETECTING'
  | 'LIFF_NATIVE_VIEW'
  | 'STANDALONE_PWA'
  | 'MOBILE_WEBVIEW'
  | 'DESKTOP_BROWSER';

interface SafeAreaContextType {
  state: SafeAreaState;
  metrics: ViewportMetrics;
  layoutMode: LayoutMode;
}

const SafeAreaContext = createContext<SafeAreaContextType>({
  state: 'ENV_DETECTING',
  metrics: {
    windowWidth: 375,
    windowHeight: 667,
    devicePixelRatio: 1,
    isTouchDevice: false,
    safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
    environment: 'DESKTOP_BROWSER',
  },
  layoutMode: 'STANDARD_WEB',
});

function toState(env: ViewportMetrics['environment'], detected: boolean): SafeAreaState {
  if (!detected) return 'ENV_DETECTING';
  if (env === 'LINE_LIFF_IOS' || env === 'LINE_LIFF_ANDROID') return 'LIFF_NATIVE_VIEW';
  if (env === 'STANDALONE_PWA') return 'STANDALONE_PWA';
  if (env === 'DESKTOP_BROWSER') return 'DESKTOP_BROWSER';
  return 'MOBILE_WEBVIEW';
}

function toLayoutMode(env: ViewportMetrics['environment']): LayoutMode {
  if (env === 'LINE_LIFF_IOS' || env === 'LINE_LIFF_ANDROID') return 'LIFF_EMBEDDED_COMPACT';
  if (env === 'IN_APP_WEBVIEW') return 'WEBVIEW_FULLSCREEN_SAFE';
  return 'STANDARD_WEB';
}

/** §10.5 self-healing: compensate --sab when a CTA is clipped by the viewport. */
export const verifyAndSelfHealLayout = (buttonRef: HTMLButtonElement | null): void => {
  if (!buttonRef || typeof window === 'undefined' || typeof document === 'undefined') return;
  const rect = buttonRef.getBoundingClientRect();
  const windowHeight = window.innerHeight;
  if (rect.bottom > windowHeight) {
    const overflowOffset = rect.bottom - windowHeight + 16;
    document.documentElement.style.setProperty('--sab', `${overflowOffset}px`);
    console.warn(`[Self-Healing] Layout overflow detected. Applied dynamic --sab compensation: ${overflowOffset}px`);
  }
};

export const SafeAreaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const metrics = useEnvironmentDetection();
  // ENV_DETECTING until the client-side probe has run at least once
  const [probed, setProbed] = useState(false);
  useEffect(() => {
    setProbed(true);
  }, [metrics]);
  const detected = probed && typeof window !== 'undefined';

  const value = useMemo<SafeAreaContextType>(() => {
    const state = toState(metrics.environment, detected);
    return { state, metrics, layoutMode: toLayoutMode(metrics.environment) };
  }, [metrics, detected]);

  // ENV_DETECTING — skeleton with 44px spacers to prevent UI jitter (§2.2)
  if (value.state === 'ENV_DETECTING') {
    return (
      <div className="safe-area-skeleton">
        <div style={{ height: 44 }} />
        <div className="safe-area-skeleton-body" />
        <div style={{ height: 44 }} />
      </div>
    );
  }

  return <SafeAreaContext.Provider value={value}>{children}</SafeAreaContext.Provider>;
};

export const useSafeArea = () => useContext(SafeAreaContext);

export default SafeAreaProvider;
