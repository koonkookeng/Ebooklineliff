// SSOT Phase 018 §6 — LIFF My Library route (tenant theme via query params)
// Canonical: apps/frontend/app/(liff)/library/page.tsx
// (legacy src/frontend/app/(liff)/library/page.tsx)
'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { MyLibraryView } from '../../../components/library/MyLibraryView';

function LiffLibraryInner() {
  const params = useSearchParams();
  const accent = params.get('color') ?? '#059669';
  const tenantLogo = params.get('logo') ?? undefined;
  return <MyLibraryView accent={accent} tenantLogo={tenantLogo} />;
}

export default function LiffLibraryPage() {
  return (
    <Suspense fallback={<MyLibraryView accent="#059669" />}>
      <LiffLibraryInner />
    </Suspense>
  );
}
