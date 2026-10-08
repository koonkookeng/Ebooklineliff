'use client';

// SSOT Phase 074 §6 — Studio builder page (wizard host)
// Canonical: apps/frontend/app/(studio)/builder/page.tsx
import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { UniversalProductBuilderWizard } from '../../../components/builder/UniversalProductBuilderWizard';

function BuilderInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  return (
    <div className="builder-page">
      <h1>Universal Product Builder</h1>
      <UniversalProductBuilderWizard slug={slug} />
    </div>
  );
}

export default function StudioBuilderPage() {
  return (
    <Suspense fallback={null}>
      <BuilderInner />
    </Suspense>
  );
}
