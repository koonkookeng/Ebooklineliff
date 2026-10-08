'use client';

// SSOT Phase 071 §6.2 — Dynamic Client Theme Injector
// Canonical: apps/frontend/lib/tenant/theme-provider.tsx
// (legacy src/frontend/lib/tenant/theme-provider.tsx)
// - Injects tenant CSS vars on :root in the first ms after mount (FOUC guard):
//   --primary-color / --secondary-color / --accent-color (+ --brand-logo-url /
//   --font-family-custom when provided). Zero-dep, client-only, <30MB safe.
// - Accepts the SSOT TenantBranding shape (§3.1); `null` keeps hub defaults.
// - ERROR state (§2.2): TenantNotFound renders the 404 fallback with a
//   central-hub redirect (no router dep — plain anchor, LIFF-safe).
import React, { createContext, useContext, useEffect } from 'react';
import type { TenantEngineBranding as TenantBranding } from '@repo/shared';

const TenantThemeContext = createContext<TenantBranding | null>(null);

function applyBrandingVars(branding: TenantBranding): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--primary-color', branding.primaryColor);
  root.style.setProperty('--secondary-color', branding.secondaryColor);
  root.style.setProperty('--accent-color', branding.accentColor);
  root.style.setProperty('--brand-logo-url', `url(${branding.logoUrl})`);
  if (branding.faviconUrl) {
    root.style.setProperty('--brand-favicon-url', `url(${branding.faviconUrl})`);
  }
  if (branding.customFontUrl) {
    root.style.setProperty('--font-family-custom', `url(${branding.customFontUrl})`);
  }
}

export const TenantThemeProvider = ({
  branding,
  children,
}: {
  branding: TenantBranding | null;
  children: React.ReactNode;
}) => {
  useEffect(() => {
    if (!branding) return;
    applyBrandingVars(branding);
  }, [branding]);

  return <TenantThemeContext.Provider value={branding}>{children}</TenantThemeContext.Provider>;
};

export const useTenantTheme = () => useContext(TenantThemeContext);

/** ERROR state (§2.2): unknown subdomain / query — safe hub redirect. */
export function TenantNotFound({
  identifier,
  hubUrl = '/',
}: {
  identifier: string;
  hubUrl?: string;
}) {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>ไม่พบร้านค้านี้ (Tenant Not Found)</h1>
      <p style={{ opacity: 0.7 }}>identifier: {identifier}</p>
      <a
        href={hubUrl}
        style={{
          padding: '10px 18px',
          borderRadius: 10,
          background: 'var(--primary-color, #16a34a)',
          color: '#fff',
          textDecoration: 'none',
          fontWeight: 600,
        }}
      >
        กลับสู่หน้าหลัก
      </a>
    </main>
  );
}
