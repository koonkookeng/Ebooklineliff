// SSOT Phase 089 Task 6 — Gift send page (studio mount)
// Canonical: apps/frontend/app/(liff)/gift/send/page.tsx
'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { GiftCreatorStudio } from '../../../../components/gift/GiftCreatorStudio';

function GiftSendInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const productId = params.get('productId') ?? '';
  const [done, setDone] = useState<string | null>(null);

  if (!productId) return <p role="alert">เลือกสินค้าก่อนส่งของขวัญ</p>;

  return (
    <div>
      <GiftCreatorStudio
        slug={slug}
        productId={productId}
        productTitle={params.get('title') ?? 'ของขวัญดิจิทัล'}
        productCoverUrl={params.get('cover') ?? ''}
        price={Number(params.get('price')) || 0}
        onCreated={(claimCode) => setDone(claimCode)}
      />
      {done && <p role="status">สร้างของขวัญ {done} แล้ว — แชร์ให้เพื่อนเลย!</p>}
    </div>
  );
}

export default function LiffGiftSendPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดห้องส่งของขวัญ…</p>}>
      <GiftSendInner />
    </Suspense>
  );
}
