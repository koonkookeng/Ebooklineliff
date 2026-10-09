// SSOT Phase 097 Task 7 — Corporate HR dashboard page
// Canonical: apps/frontend/app/(dashboard)/corporate/page.tsx
'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CorporateDashboard } from '../../../components/b2b/CorporateDashboard';

function CorporateInner() {
  const params = useSearchParams();
  const accountId = params.get('accountId') ?? '';
  if (!accountId) return <p role="alert">เลือกรหัสองค์กรก่อนดูแดชบอร์ด</p>;
  return <CorporateDashboard corporateAccountId={accountId} />;
}

export default function CorporateDashboardPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดแดชบอร์ดองค์กร…</p>}>
      <CorporateInner />
    </Suspense>
  );
}
