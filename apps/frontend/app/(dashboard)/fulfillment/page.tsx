// SSOT Phase 076 §6 — Fulfillment queue dashboard (ledger + booking)
// Canonical: apps/frontend/app/(dashboard)/fulfillment/page.tsx
'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFulfillmentQueue } from '../../../hooks/useFulfillmentQueue';
import { fulfillmentApi } from '../../../lib/fulfillment/fulfillment-client';

function FulfillmentInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const [warehouseId, setWarehouseId] = useState(params.get('warehouse') ?? '');
  const [courier, setCourier] = useState('FLASH_EXPRESS');
  const [batchIds, setBatchIds] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { status, error, rows, total, filter, setFilter, page, setPage, retry, reload } = useFulfillmentQueue(slug);

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!warehouseId) {
      setMsg('ERROR: กรุณากรอก Warehouse ID');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const orderIds = batchIds.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      const res = (await fulfillmentApi(slug).book({ orderIds, courierProvider: courier, warehouseId })) as {
        batchId: string; batchNumber: string; queued: number; failed: Array<{ orderId: string; reason: string }>;
      };
      const drain = (await fulfillmentApi(slug).drain(res.batchId, {
        orderIds, warehouseId, courierProvider: courier,
      })) as { booked: number; failed: Array<{ orderId: string; reason: string }> };
      setMsg(`Batch ${res.batchNumber}: เข้าคิว ${res.queued} • ออกเลข ${drain.booked} ใบ`);
      await reload();
    } catch (err) {
      setMsg(`ERROR: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>คิวจัดส่ง {slug}</h1>
      <div className="merchant-form" style={{ flexDirection: 'row' }}>
        <input placeholder="กรองตามสถานะ (BOOKED/…)" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" onClick={retry}>ค้นหา</button>
      </div>
      <form onSubmit={book} className="merchant-form">
        <input placeholder="Warehouse ID (uuid)" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} />
        <select value={courier} onChange={(e) => setCourier(e.target.value)}>
          <option value="FLASH_EXPRESS">Flash Express</option>
          <option value="KEX_EXPRESS">KEX</option>
          <option value="JT_EXPRESS">J&T</option>
          <option value="THAILAND_POST">Thailand Post</option>
          <option value="CUSTOM_FLEET">Custom Fleet</option>
        </select>
        <input placeholder="Order IDs (คั่นด้วยจุลภาค)" value={batchIds} onChange={(e) => setBatchIds(e.target.value)} required />
        <button type="submit" disabled={busy}>{busy ? 'กำลังจองเลข…' : 'Batch Courier Booking'}</button>
      </form>
      {status === 'ERROR' && error && <p role="alert">{error}</p>}
      <table className="merchant-table">
        <thead>
          <tr><th>Order</th><th>ขนส่ง</th><th>Tracking</th><th>สถานะ</th></tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((r) => (
            <tr key={r.orderId}>
              <td>{r.orderNumber}</td>
              <td>{r.courierProvider}</td>
              <td className="font-mono">{r.trackingNumber ?? '-'}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>ทั้งหมด {total} รายการ · หน้า {page}</p>
      <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
      <button type="button" onClick={() => setPage(page + 1)}>→</button>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}

export default function FulfillmentPage() {
  return (
    <Suspense fallback={null}>
      <FulfillmentInner />
    </Suspense>
  );
}
