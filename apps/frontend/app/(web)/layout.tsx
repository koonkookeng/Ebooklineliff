// SSOT Phase 072 Task 5 — Web segment layout (company theme host)
// Canonical: apps/frontend/app/(web)/layout.tsx
// - Mounts DynamicCompanyThemeProvider around the web segment (slug from
//   middleware x-tenant-slug is not readable here; pages pass ?tenant= via
//   the providerSlug helper — default hub renders Ahong Emerald fallback).
// - 'use client' (search params are client-side, Phase 021 precedent).
'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { DynamicCompanyThemeProvider } from '../../components/theme/DynamicThemeProvider';

function WebThemeInner({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  return <DynamicCompanyThemeProvider slug={slug}>{children}</DynamicCompanyThemeProvider>;
}

export default function WebSegmentLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <WebThemeInner>{children}</WebThemeInner>
    </Suspense>
  );
}
