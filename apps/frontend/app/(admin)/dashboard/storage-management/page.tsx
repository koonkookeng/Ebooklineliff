// SSOT Phase 123 Task 7 §6.1 — storage management console page (5-state)
// Canonical: apps/frontend/app/(admin)/dashboard/storage-management/page.tsx
// (legacy src/frontend/app/(admin)/dashboard/storage-management/page.tsx)
// - Suspense boundary (useSearchParams) + tenant/bucket selectors +
//   dep-free StorageDashboard. Zero new deps.
'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { StorageDashboard } from '@/components/storage/StorageDashboard';

function StorageManagementInner() {
  const params = useSearchParams();
  const tenant = params.get('tenant') ?? 'default';
  const bucket = params.get('bucket') ?? 'omni-commerce-vault';
  return <StorageDashboard tenant={tenant} bucket={bucket} />;
}

export default function StorageManagementPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-400">กำลังโหลด Storage Center...</div>}>
      <StorageManagementInner />
    </Suspense>
  );
}
