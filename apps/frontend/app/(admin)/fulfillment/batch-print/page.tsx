// SSOT Phase 077 §6.2 — Merchant batch fulfillment studio
// Canonical: apps/frontend/app/(admin)/fulfillment/batch-print/page.tsx
'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { BatchBookingPanel } from '../../../../components/fulfillment/BatchBookingPanel';

function BatchPrintInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  return (
    <div>
      <h1>ระบบออกเลขพัสดุและพิมพ์ใบปะหน้าอัตโนมัติ {slug}</h1>
      <p>เลือกคำสั่งซื้อเพื่อจองขนส่งและออกสติ๊กเกอร์ 100x150mm</p>
      <BatchBookingPanel slug={slug} />
    </div>
  );
}

export default function BatchPrintPage() {
  return (
    <Suspense fallback={null}>
      <BatchPrintInner />
    </Suspense>
  );
}
