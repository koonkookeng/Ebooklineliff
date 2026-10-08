// SSOT Phase 073 §6.1 — Merchant dashboard segment layout
// Canonical: apps/frontend/app/(dashboard)/merchant/layout.tsx
// - Company theme per ?tenant= + DashboardShell states via the hook.
// - 'use client' (search params, Phase 021 precedent). Zero new deps.
'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { DynamicCompanyThemeProvider } from '../../../components/theme/DynamicThemeProvider';
import { DashboardShell } from '../../../components/dashboard/DashboardShell';
import { useMerchantDashboard } from '../../../hooks/useMerchantDashboard';

function MerchantInner({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const { status, error, retry } = useMerchantDashboard(slug);
  return (
    <DynamicCompanyThemeProvider slug={slug}>
      <DashboardShell status={status} error={error} onRetry={retry} storeName={slug}>
        {children}
      </DashboardShell>
    </DynamicCompanyThemeProvider>
  );
}

export default function MerchantDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <MerchantInner>{children}</MerchantInner>
    </Suspense>
  );
}
