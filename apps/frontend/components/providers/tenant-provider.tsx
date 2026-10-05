// SSOT Phase 001 §6 — tenant CSS vars provider (SSR-first ms injection via middleware headers)
'use client';

import React, { createContext, useContext } from 'react';

export interface TenantTheme {
  primary: string;
  logo: string;
  font: string;
}

const DEFAULT_THEME: TenantTheme = {
  primary: '#16a34a',
  logo: '/logo.svg',
  font: 'Prompt, sans-serif',
};

const TenantContext = createContext<TenantTheme>(DEFAULT_THEME);

export function TenantProvider({
  children,
  theme = DEFAULT_THEME,
}: {
  children: React.ReactNode;
  theme?: TenantTheme;
}) {
  return <TenantContext.Provider value={theme}>{children}</TenantContext.Provider>;
}

export const useTenant = () => useContext(TenantContext);
