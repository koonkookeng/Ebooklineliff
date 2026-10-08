// SSOT Phase 079 Task 4 — LIFF Affiliate Partner Hub
// Canonical: apps/frontend/app/(liff)/affiliate/page.tsx
'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAffiliateHub } from '../../../hooks/useAffiliateHub';
import { AffiliateDashboard } from '../../../components/affiliate/AffiliateDashboard';
import { LineFlexShareButton } from '../../../components/affiliate/LineFlexShareButton';

function AffiliateInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const [productId, setProductId] = useState(params.get('product') ?? '');
  const { status, error, dashboard, retry } = useAffiliateHub(slug);

  if (status === 'LIFF_INIT' || status === 'LOADING') return <p>กำลังโหลด Affiliate Hub…</p>;
  if (status === 'ERROR') {
    return (
      <div>
        <p role="alert">โหลดไม่สำเร็จ: {error}</p>
        <button type="button" onClick={retry}>ลองใหม่</button>
      </div>
    );
  }
  if (!dashboard) return <p>ยังไม่มีข้อมูลพาร์ทเนอร์</p>;

  return (
    <div>
      <h1>Affiliate Partner Hub</h1>
      <AffiliateDashboard slug={slug} initial={dashboard} />
      <h2>ป้ายยาสินค้า</h2>
      <input placeholder="Product ID (uuid)" value={productId} onChange={(e) => setProductId(e.target.value)} />
      {productId && <LineFlexShareButton slug={slug} productId={productId} productTitle="แนะนำสิ่งนี้ให้คุณ" />}
    </div>
  );
}

export default function LiffAffiliatePage() {
  return (
    <Suspense fallback={<p>กำลังโหลด Affiliate Hub…</p>}>
      <AffiliateInner />
    </Suspense>
  );
}
