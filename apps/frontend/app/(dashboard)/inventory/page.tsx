'use client';

// SSOT Phase 075 §6 — Inventory stock overview (warehouse ledger table)
// Canonical: apps/frontend/app/(dashboard)/inventory/page.tsx
import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useInventoryWorkspace } from '../../../hooks/useInventoryWorkspace';
import { StockTable } from '../../../components/inventory/BatchStockWorkspace';

function InventoryInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const [warehouseId, setWarehouseId] = useState(params.get('warehouse') ?? '');
  const { status, error, rows, total, query, setQuery, page, setPage, retry } = useInventoryWorkspace(slug, warehouseId);

  return (
    <div>
      <h1>คลังสินค้า {slug}</h1>
      <div className="merchant-form" style={{ flexDirection: 'row' }}>
        <input placeholder="Warehouse ID (uuid)" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} />
        <input placeholder="ค้นหา SKU" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" onClick={retry}>ค้นหา</button>
      </div>
      {status === 'ERROR' && error && <p role="alert">{error}</p>}
      <StockTable rows={rows} />
      <p>ทั้งหมด {total} รายการ · หน้า {page}</p>
      <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
      <button type="button" onClick={() => setPage(page + 1)}>→</button>
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={null}>
      <InventoryInner />
    </Suspense>
  );
}
