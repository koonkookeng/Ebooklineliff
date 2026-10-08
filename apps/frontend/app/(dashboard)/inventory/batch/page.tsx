'use client';

// SSOT Phase 075 BDD-2 — Batch stock workspace page
// Canonical: apps/frontend/app/(dashboard)/inventory/batch/page.tsx
import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BatchStockWorkspace } from '../../../../components/inventory/BatchStockWorkspace';

function BatchInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const [warehouseId, setWarehouseId] = useState(params.get('warehouse') ?? '');
  const [userId, setUserId] = useState('');

  if (!warehouseId || !userId) {
    return (
      <div className="merchant-form">
        <h1>Batch Stock Update</h1>
        <input placeholder="Warehouse ID (uuid)" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} />
        <input placeholder="Your User ID (uuid)" value={userId} onChange={(e) => setUserId(e.target.value)} />
      </div>
    );
  }
  return <BatchStockWorkspace slug={slug} warehouseId={warehouseId} userId={userId} />;
}

export default function InventoryBatchPage() {
  return (
    <Suspense fallback={null}>
      <BatchInner />
    </Suspense>
  );
}
