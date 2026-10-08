'use client';

// SSOT Phase 072 §6.2 — Zero-FOUC Dynamic Company Theme Provider
// Canonical: apps/frontend/components/theme/DynamicThemeProvider.tsx
// - State machine (§2.2): THEME_INIT -> THEME_RESOLVED -> THEME_SUCCESS /
//   THEME_ERROR (fallback Ahong Emerald); in-page switches pass through
//   THEME_LOADING (brand-neutral skeleton + fade overlay).
// - Applies the full token set on :root in the first effect (FOUC guard),
//   preloads the tenant font with 800ms system fallback, unloads prior fonts
//   + revokes blob URLs on switch/unmount (BDD-3, LIFF RAM <30MB).
// - Zero-dep (React + theme-client only). Watermark consumers read the logo
//   via useCompanyTheme().logoUrl (Canvas Reader link, §8.1 — no canvas
//   algorithm change per OUT_OF_SCOPE).
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AHONG_EMERALD_FALLBACK, type CompanyThemeConfig } from '@repo/shared';
import {
  applyCompanyThemeVars,
  fetchCompanyTheme,
  preloadTenantFont,
  unloadTenantFont,
} from '../../lib/theme/company-theme-client';

export type CompanyThemeStatus =
  | 'THEME_INIT'
  | 'THEME_RESOLVED'
  | 'THEME_LOADING'
  | 'THEME_SUCCESS'
  | 'THEME_ERROR';

const CompanyThemeContext = createContext<{ theme: CompanyThemeConfig; status: CompanyThemeStatus }>({
  theme: AHONG_EMERALD_FALLBACK,
  status: 'THEME_INIT',
});

export function DynamicCompanyThemeProvider({
  slug,
  initialTheme,
  children,
}: {
  slug: string;
  initialTheme?: CompanyThemeConfig | null;
  children: React.ReactNode;
}) {
  const [theme, setTheme] = useState<CompanyThemeConfig>(initialTheme ?? AHONG_EMERALD_FALLBACK);
  const [status, setStatus] = useState<CompanyThemeStatus>(initialTheme ? 'THEME_SUCCESS' : 'THEME_INIT');
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    let cancelled = false;
    async function load(nextSlug: string, isSwitch: boolean) {
      if (isSwitch && live.current) setStatus('THEME_LOADING');
      try {
        const resolved = await fetchCompanyTheme(nextSlug);
        if (cancelled) return;
        applyCompanyThemeVars(resolved);
        await preloadTenantFont(resolved);
        if (cancelled) return;
        setTheme(resolved);
        setStatus('THEME_SUCCESS');
      } catch {
        if (cancelled) return;
        applyCompanyThemeVars(AHONG_EMERALD_FALLBACK);
        setTheme(AHONG_EMERALD_FALLBACK);
        setStatus('THEME_ERROR');
      }
    }
    if (initialTheme) {
      applyCompanyThemeVars(initialTheme);
      void preloadTenantFont(initialTheme);
    } else {
      setStatus('THEME_RESOLVED');
      void load(nextSlugSafe(slug), false);
    }
    return () => {
      cancelled = true;
    };
  }, [slug, initialTheme]);

  useEffect(
    () => () => {
      live.current = false;
      unloadTenantFont();
    },
    [],
  );

  if (status === 'THEME_INIT' || status === 'THEME_RESOLVED') {
    return (
      <CompanyThemeContext.Provider value={{ theme, status }}>
        <CompanyThemeSkeleton />
      </CompanyThemeContext.Provider>
    );
  }

  return (
    <CompanyThemeContext.Provider value={{ theme, status }}>
      {status === 'THEME_LOADING' && <CompanyThemeFadeOverlay />}
      {children}
    </CompanyThemeContext.Provider>
  );
}

function nextSlugSafe(slug: string): string {
  return (slug ?? '').trim() || 'default';
}

export const useCompanyTheme = () => useContext(CompanyThemeContext);

/** THEME_LOADING: brand-neutral skeleton (no tenant assets, RAM-flat). */
export function CompanyThemeSkeleton() {
  return (
    <div className="theme-skeleton" aria-busy="true" aria-label="กำลังโหลดธีมร้านค้า">
      <div className="theme-skeleton-bar" />
      <div className="theme-skeleton-grid">
        <div className="theme-skeleton-card" />
        <div className="theme-skeleton-card" />
        <div className="theme-skeleton-card" />
      </div>
    </div>
  );
}

/** In-switch fade overlay (150ms, CSS-only transition). */
function CompanyThemeFadeOverlay() {
  return <div className="theme-fade-overlay" aria-hidden="true" />;
}
