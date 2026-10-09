// SSOT Phase 097 BDD-2 — LIFF B2B claim page
// Canonical: apps/frontend/app/(liff)/b2b/claim/page.tsx
'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CorporateClaimCard } from '../../../../components/b2b/CorporateClaimCard';

function B2bClaimInner() {
  const params = useSearchParams();
  const code = params.get('code');
  if (!code) return <p role="alert">ลิงก์รับสิทธิ์ไม่ถูกต้อง</p>;
  return <CorporateClaimCard code={code} />;
}

export default function LiffB2bClaimPage() {
  return (
    <Suspense fallback={<p>กำลังเตรียมรับสิทธิ์องค์กร…</p>}>
      <B2bClaimInner />
    </Suspense>
  );
}
