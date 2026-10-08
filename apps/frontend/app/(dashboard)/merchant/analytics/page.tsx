'use client';

// SSOT Phase 073 Task 5 — Analytics explorer (tenant-isolated rows + bars)
// Canonical: apps/frontend/app/(dashboard)/merchant/analytics/page.tsx
import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { merchantApi, type AnalyticsRow } from '../../../../lib/dashboard/dashboard-client';

function AnalyticsInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const [rows, setRows] = useState<AnalyticsRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setMsg(null);
    try {
      const to = new Date();
      const from = new Date(Date.now() - 90 * 86400000);
      const data = await merchantApi(slug).analytics(from.toISOString(), to.toISOString());
      setRows(data.rows);
    } catch (err) {
      setMsg(`ERROR: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const max = Math.max(1, ...rows.map((r) => Number(r.totalGmv || 0)));

  return (
    <div>
      <h1>วิเคราะห์ยอดขาย</h1>
      <button type="button" onClick={() => void load()} disabled={busy}>
        {busy ? 'กำลังโหลด…' : 'โหลด 90 วัน'}
      </button>
      {msg && <p role="alert">{msg}</p>}
      <table className="merchant-table">
        <thead>
          <tr><th>วันที่</th><th>GMV</th><th>ออเดอร์</th><th>E-Book</th><th>คอร์ส</th><th>เล่ม</th><th>นร.ใหม่</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.recordDate}>
              <td>{r.recordDate.slice(0, 10)}</td>
              <td>฿{Number(r.totalGmv || 0).toFixed(2)}</td>
              <td>{r.totalOrders}</td>
              <td>{r.ebookSalesCount}</td>
              <td>{r.courseSalesCount}</td>
              <td>{r.physicalSalesCount}</td>
              <td>{r.newStudentsCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="merchant-bars" aria-label="gmv bars">
        {rows.map((r) => (
          <div key={r.recordDate} className="merchant-bar" title={`${r.recordDate.slice(0, 10)}: ฿${r.totalGmv}`}>
            <div style={{ height: `${Math.round((Number(r.totalGmv || 0) / max) * 100)}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MerchantAnalyticsPage() {
  return (
    <Suspense fallback={null}>
      <AnalyticsInner />
    </Suspense>
  );
}
