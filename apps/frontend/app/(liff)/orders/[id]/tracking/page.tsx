// SSOT Phase 077 Task 7 — Buyer LIFF tracking page (stepper, <25MB)
// Canonical: apps/frontend/app/(liff)/orders/[id]/tracking/page.tsx
'use client';

import React, { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useShipmentTracking } from '../../../../../hooks/useShipmentTracking';
import { TrackingStepper } from '../../../../../components/fulfillment/TrackingStepper';

function TrackingInner() {
  const params = useParams<{ id: string }>();
  const query = useSearchParams();
  const slug = query.get('tenant') ?? 'default';
  const { status, error, tracking, retry } = useShipmentTracking(slug, params.id);

  if (status === 'LIFF_INIT' || status === 'LOADING') return <p>กำลังโหลดสถานะพัสดุ…</p>;
  if (status === 'ERROR') {
    return (
      <div>
        <p role="alert">โหลดไม่สำเร็จ: {error}</p>
        <button type="button" onClick={retry}>ลองใหม่</button>
      </div>
    );
  }
  if (!tracking) return <p>ยังไม่มีข้อมูลการจัดส่งสำหรับคำสั่งซื้อนี้</p>;

  return (
    <div>
      <h1>พัสดุ {tracking.orderNumber}</h1>
      <p className="font-mono">{tracking.trackingNumber}</p>
      <TrackingStepper carrier={tracking.carrier} status={tracking.status} />
      <ul>
        {tracking.history.map((h, ix) => (
          <li key={ix}>
            {h.statusText} {h.location ? `· ${h.location}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LiffTrackingPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดสถานะพัสดุ…</p>}>
      <TrackingInner />
    </Suspense>
  );
}
