// SSOT Phase 051 §6.1 — LIFF ebook preview route (trial funnel entry)
// Canonical: apps/frontend/app/(liff)/preview/[productId]/page.tsx
// (legacy src/frontend/app/(liff)/preview/**/*)
// - 5-state shell: LIFF_INIT splash → CanvasPreviewReader owns
//   PREVIEW_ACTIVE / LIMIT_REACHED / ERROR. Display meta arrives via query
//   (?title=&price=&cover=) from PDP/share cards; chunk content is gated
//   server-side so meta fallbacks never leak paid content.
'use client';

import React, { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { CanvasPreviewReader } from '../../../../components/reader/CanvasPreviewReader';

function LiffPreviewInner() {
  const params = useParams<{ productId: string }>();
  const search = useSearchParams();
  const productId = Array.isArray(params.productId) ? params.productId[0] : params.productId;
  const title = search.get('title') ?? 'เนื้อหาตัวอย่าง';
  const price = Number(search.get('price') ?? 0);
  const discount = search.get('discount') ? Number(search.get('discount')) : undefined;
  const cover = search.get('cover') ?? '/covers/default.png';
  if (!productId) {
    return <div role="alert" className="p-6 text-center text-white">ไม่พบสินค้าที่ต้องการทดลองอ่าน</div>;
  }
  return (
    <CanvasPreviewReader
      productId={productId}
      productTitle={title}
      price={Number.isFinite(price) ? price : 0}
      discountPrice={discount && Number.isFinite(discount) ? discount : undefined}
      coverImageUrl={cover}
    />
  );
}

export default function LiffPreviewPage() {
  return (
    <Suspense fallback={<div role="status" aria-label="loading preview" className="min-h-screen w-full animate-pulse bg-slate-900" />}>
      <LiffPreviewInner />
    </Suspense>
  );
}
