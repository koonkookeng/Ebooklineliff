// SSOT Phase 074 §6 — Studio builder segment layout
// Canonical: apps/frontend/app/(studio)/builder/layout.tsx
// - Company theme per ?tenant= (studio is web desktop; LIFF untouched).
// - 'use client' (search params, Phase 021 precedent). Zero new deps.
'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { DynamicCompanyThemeProvider } from '../../../components/theme/DynamicThemeProvider';

function StudioInner({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  return <DynamicCompanyThemeProvider slug={slug}>{children}</DynamicCompanyThemeProvider>;
}

export default function StudioBuilderLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <StudioInner>{children}</StudioInner>
    </Suspense>
  );
}
