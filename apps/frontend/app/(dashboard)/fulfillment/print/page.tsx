// SSOT Phase 076 BDD-2 — Batch thermal label print workspace
// Canonical: apps/frontend/app/(dashboard)/fulfillment/print/page.tsx
'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { BatchThermalLabelPrinter } from '../../../../components/thermal-print/BatchThermalLabelPrinter';

function PrintInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  return (
    <div>
      <h1>พิมพ์ใบปะหน้า 100x150mm {slug}</h1>
      <BatchThermalLabelPrinter slug={slug} />
    </div>
  );
}

export default function FulfillmentPrintPage() {
  return (
    <Suspense fallback={null}>
      <PrintInner />
    </Suspense>
  );
}
