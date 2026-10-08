'use client';

// SSOT Phase 075 Task 6 — Batch thermal label printing (PDF/ZPL/TSPL)
// Canonical: apps/frontend/app/(dashboard)/inventory/labels/page.tsx
import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { inventoryApi } from '../../../../lib/inventory/inventory-client';

function LabelsInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const [orderIds, setOrderIds] = useState('');
  const [format, setFormat] = useState('PDF_A6');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const ids = orderIds.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      const res = await inventoryApi(slug).labels({ orderIds: ids, labelFormat: format });
      setMsg(`สร้าง ${res.count} ใบปะหน้า: ${res.objectKey}`);
      window.open(res.downloadUrl, '_blank');
    } catch (err) {
      setMsg(`ERROR: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>พิมพ์ใบปะหน้า (Batch)</h1>
      <form onSubmit={submit} className="merchant-form">
        <input placeholder="Order IDs (คั่นด้วยจุลภาค)" value={orderIds} onChange={(e) => setOrderIds(e.target.value)} required />
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="PDF_A6">PDF A6</option>
          <option value="ZPL_4X6">ZPL 4x6</option>
          <option value="TSPL_100X150">TSPL 100x150</option>
        </select>
        <button type="submit" disabled={busy}>{busy ? 'กำลังสร้าง…' : 'สร้างใบปะหน้า'}</button>
      </form>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}

export default function InventoryLabelsPage() {
  return (
    <Suspense fallback={null}>
      <LabelsInner />
    </Suspense>
  );
}
