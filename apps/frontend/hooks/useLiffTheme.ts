// SSOT Phase 030 Task 3/§6.1 — useLiffTheme (CSS vars + native navbar sync)
// Canonical: apps/frontend/hooks/useLiffTheme.ts
// (legacy src/frontend/hooks/useLiffTheme.ts)
// - Injects --primary-color/--nav-bg/--nav-text on :root (layout reserves space,
//   CLS = 0), then calls the LIFF native bar API when available; outside LINE
//   (or on API failure) the web vars alone carry the brand (ERROR fallback).
// - 5 states: LIFF_INIT (no branding yet) → LOADING (applying) → SUCCESS
//   (vars set; native best-effort) / ERROR (outside LINE or API threw) / IDLE
//   is exposed while branding is null and no apply is running.
// - RAM guard: SDK via lib singleton (no static import in hotspot); no listeners.
// - Zero new deps.
'use client';

import { useEffect, useRef, useState } from 'react';
import type { TenantBranding } from '@repo/shared';
import { getLiff } from '../lib/liff/liff-sdk';

export type LiffThemeStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

/** Apply brand vars to :root (pure DOM, testable via injected root). */
export function applyThemeVars(
  branding: TenantBranding,
  root: { style: { setProperty: (k: string, v: string) => void } },
): void {
  root.style.setProperty('--primary-color', branding.primaryColor);
  root.style.setProperty('--nav-bg', branding.navBarBgColor);
  root.style.setProperty('--nav-text', branding.navBarTextColor);
  root.style.setProperty('--nav-bg-color', branding.navBarBgColor);
  root.style.setProperty('--nav-text-color', branding.navBarTextColor);
}

async function syncNativeNavbar(branding: TenantBranding): Promise<boolean> {
  try {
    const liff = await getLiff();
    const setColor = (liff as unknown as { setNavigationBarColor?: (args: { backgroundColor: string; textColor: string }) => void })
      .setNavigationBarColor;
    if (typeof setColor !== 'function') return false;
    setColor.call(liff, { backgroundColor: branding.navBarBgColor, textColor: branding.navBarTextColor });
    return true;
  } catch {
    return false;
  }
}

export function useLiffTheme(branding: TenantBranding | null) {
  const [status, setStatus] = useState<LiffThemeStatus>(branding ? 'LOADING' : 'LIFF_INIT');
  const appliedRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!branding) {
      setStatus('LIFF_INIT');
      return;
    }
    // Steady state: same tenant already applied — no redundant DOM writes.
    if (appliedRef.current === branding.tenantId) {
      setStatus('IDLE');
      return;
    }
    setStatus('LOADING');
    try {
      applyThemeVars(branding, document.documentElement);
      appliedRef.current = branding.tenantId;
    } catch {
      if (!cancelled) setStatus('ERROR');
      return;
    }
    void syncNativeNavbar(branding).then((native) => {
      if (cancelled) return;
      setStatus(native ? 'SUCCESS' : 'ERROR');
    });
    return () => {
      cancelled = true;
    };
  }, [branding]);

  return { status };
}
