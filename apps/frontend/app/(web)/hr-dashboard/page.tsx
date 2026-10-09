// SSOT Phase 098 Task 5 — HR dashboard web entry
// Canonical: apps/frontend/app/(web)/hr-dashboard/page.tsx
'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { HrDashboard } from '../../../components/hr/HrDashboard';

function HrDashboardInner() {
  const params = useSearchParams();
  const orgId = params.get('orgId');
  if (!orgId) return <p role="alert">Missing organization</p>;
  return <HrDashboard organizationId={orgId} />;
}

export default function WebHrDashboardPage() {
  return (
    <Suspense fallback={<p>Loading HR dashboard…</p>}>
      <HrDashboardInner />
    </Suspense>
  );
}
