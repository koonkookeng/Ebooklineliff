// SSOT Phase 030 Task 5/§2.1 — TenantThemeProvider (segment theme sync core)
// Canonical: apps/frontend/providers/TenantThemeProvider.tsx
// (legacy src/frontend/providers/TenantThemeProvider.tsx)
// - Resolves tenant (?tenant= → 'default'), serves stale-while-revalidate:
//   offline cache first (0ms paint, CLS = 0) → network refresh → cache write.
// - Applies the brand via useLiffTheme (same vars + native sync as the
//   customizer — single shared singleton path, §9).
// - 5 states via useLiffTheme + fetch phase: LIFF_INIT (no branding) →
//   LOADING (fetching) → SUCCESS (native synced) / ERROR (web fallback) /
//   IDLE (steady, cache hit or re-render).
// - Null-render (context only); fetch errors fall back to cache, then defaults.
// - Zero new deps.
'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TenantBrandingSchema, type TenantBranding } from '@repo/shared';
import { useLiffTheme, type LiffThemeStatus } from '../hooks/useLiffTheme';
import { readCachedTheme, writeCachedTheme } from '../lib/theme/theme-cache';

interface TenantThemeContextValue {
  branding: TenantBranding | null;
  status: LiffThemeStatus;
  tenantSlug: string;
}

const TenantThemeContext = createContext<TenantThemeContextValue>({
  branding: null,
  status: 'LIFF_INIT',
  tenantSlug: 'default',
});

export function useTenantTheme(): TenantThemeContextValue {
  return useContext(TenantThemeContext);
}

async function fetchBranding(tenantSlug: string): Promise<TenantBranding | null> {
  try {
    const res = await fetch(`/api/v1/tenant/theme?slug=${encodeURIComponent(tenantSlug)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const parsed = TenantBrandingSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function TenantThemeProvider({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const tenantSlug = params.get('tenant') ?? 'default';
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [fetching, setFetching] = useState(true);
  const { status: themeStatus } = useLiffTheme(branding);

  useEffect(() => {
    let cancelled = false;
    setFetching(true);
    void (async () => {
      const cached = await readCachedTheme(tenantSlug);
      if (cancelled) return;
      if (cached) setBranding(cached.branding);
      const fresh = await fetchBranding(tenantSlug);
      if (cancelled) return;
      if (fresh) {
        setBranding(fresh);
        await writeCachedTheme(tenantSlug, fresh);
      }
      setFetching(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  const status = fetching && !branding ? 'LOADING' : themeStatus;
  const value: TenantThemeContextValue = { branding, status, tenantSlug };
  return <TenantThemeContext.Provider value={value}>{children}</TenantThemeContext.Provider>;
}

export default TenantThemeProvider;
