'use client';

// SSOT Phase 073 BDD-1 — Fulfillment label workspace (forward-only flow)
// Canonical: apps/frontend/app/(dashboard)/merchant/orders/page.tsx
import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { merchantApi } from '../../../../lib/dashboard/dashboard-client';

function OrdersInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    orderId: '', warehouseId: '', status: 'PACKED', courierName: 'Flash', trackingNumber: '',
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await merchantApi(slug).fulfillment(form);
      setMsg(`Fulfillment ${res.fulfillmentId}: ${res.status}`);
    } catch (err) {
      setMsg(`ERROR: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <h1>พัสดุ & ใบปะหน้า</h1>
      <form onSubmit={submit} className="merchant-form">
        <input placeholder="Order ID (uuid)" value={form.orderId} onChange={set('orderId')} required />
        <input placeholder="Warehouse ID (uuid)" value={form.warehouseId} onChange={set('warehouseId')} required />
        <select value={form.status} onChange={set('status')}>
          <option value="PACKED">PACKED</option>
          <option value="SHIPPED">SHIPPED</option>
          <option value="DELIVERED">DELIVERED</option>
          <option value="RETURNED">RETURNED</option>
        </select>
        <input placeholder="ขนส่ง" value={form.courierName} onChange={set('courierName')} />
        <input placeholder="Tracking" value={form.trackingNumber} onChange={set('trackingNumber')} />
        <button type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'ออกใบปะหน้า'}</button>
      </form>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}

export default function MerchantOrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersInner />
    </Suspense>
  );
}
