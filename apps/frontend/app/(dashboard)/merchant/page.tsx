'use client';

// SSOT Phase 073 §6 — Merchant overview (GMV / orders / students cards)
// Canonical: apps/frontend/app/(dashboard)/merchant/page.tsx
import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMerchantDashboard } from '../../../hooks/useMerchantDashboard';

function OverviewInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const { totals, rows } = useMerchantDashboard(slug);
  const max = Math.max(1, ...rows.map((r) => Number(r.totalGmv || 0)));
  return (
    <div>
      <h1>ภาพรวมร้าน {slug}</h1>
      <div className="merchant-cards">
        <div className="merchant-card"><span>GMV 30 วัน</span><strong>฿{totals.gmv.toFixed(2)}</strong></div>
        <div className="merchant-card"><span>ออเดอร์</span><strong>{totals.orders}</strong></div>
        <div className="merchant-card"><span>นักเรียนใหม่</span><strong>{totals.students}</strong></div>
      </div>
      <h2>ยอดขายรายวัน</h2>
      <div className="merchant-bars" aria-label="daily GMV">
        {rows.map((r) => (
          <div key={r.recordDate} className="merchant-bar" title={`${r.recordDate}: ฿${r.totalGmv}`}>
            <div style={{ height: `${Math.round((Number(r.totalGmv || 0) / max) * 100)}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MerchantOverviewPage() {
  return (
    <Suspense fallback={null}>
      <OverviewInner />
    </Suspense>
  );
}
