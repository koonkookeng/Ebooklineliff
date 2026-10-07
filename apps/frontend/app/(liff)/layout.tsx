// SSOT Phase 021 Task 5 — LIFF segment layout (tenant-aware LiffProvider wrapper)
// Phase 023 §9: DynamicHeaderIntegrator mounted above segment content (null-safe:
// renders nothing until a page sets header context).
// Canonical: apps/frontend/app/(liff)/layout.tsx
// - Reads ?tenant= for multi-tenant LIFF ID resolution (middleware injects x-liff-id)
// - Dynamic import with ssr:false equivalent: provider is 'use client' + dynamic SDK import
'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { LiffProvider } from './providers/liff-provider';
import { DynamicHeaderIntegrator } from '../../components/header/DynamicHeaderIntegrator';
import { LiffRouterProvider } from '../../components/navigation/liff-router-provider';
// Phase 029 §6: null-render perf hosts (dwell prefetch + RUM beacons, zero-touch).
import { PrefetchObserver } from '../../components/performance/PrefetchObserver';
import { RumReporter } from '../../components/performance/RumReporter';
// Phase 030 Task 5: segment theme sync (CSS vars + native navbar, null-render).
import { TenantThemeProvider } from '../../providers/TenantThemeProvider';

function resolveLiffId(tenant: string): string {
  if (typeof window !== 'undefined') {
    const fromMeta = document.querySelector('meta[name="liff-id"]')?.getAttribute('content');
    if (fromMeta) return fromMeta;
  }
  if (tenant !== 'default' && process.env[`NEXT_PUBLIC_LIFF_ID_${tenant.toUpperCase()}`]) {
    return process.env[`NEXT_PUBLIC_LIFF_ID_${tenant.toUpperCase()}`] as string;
  }
  return process.env.NEXT_PUBLIC_DEFAULT_LIFF_ID ?? process.env.NEXT_PUBLIC_LIFF_ID ?? 'default-liff-id';
}

function LiffSegmentInner({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const tenantId = params.get('tenant') ?? 'default';
  const liffId = resolveLiffId(tenantId);
  return (
    <LiffProvider liffId={liffId} tenantId={tenantId}>
      <LiffRouterProvider>
        <TenantThemeProvider>
          <DynamicHeaderIntegrator />
          <PrefetchObserver />
          <RumReporter />
          {children}
        </TenantThemeProvider>
      </LiffRouterProvider>
    </LiffProvider>
  );
}

export default function LiffSegmentLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-full items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-4">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm font-medium text-muted-foreground">กำลังโหลดระบบ LINE Mini App...</p>
          </div>
        </div>
      }
    >
      <LiffSegmentInner>{children}</LiffSegmentInner>
    </Suspense>
  );
}
