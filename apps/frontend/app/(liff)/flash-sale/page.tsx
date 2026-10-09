// SSOT Phase 087 Task 5 — LIFF flash sale page (countdown + lock → checkout)
// Canonical: apps/frontend/app/(liff)/flash-sale/page.tsx
'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useFlashSale } from '../../../hooks/useFlashSale';
import { FlashSaleBanner } from '../../../components/flash-sale/FlashSaleBanner';

function FlashSaleInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const { status, error, campaign, lock, reserve, retry } = useFlashSale(slug);
  const [holdMsg, setHoldMsg] = useState<string | null>(null);

  if (status === 'LIFF_INIT' || status === 'LOADING') return <p>กำลังโหลด Flash Sale…</p>;
  if (status === 'ERROR' && !campaign) {
    return (
      <div>
        <p role="alert">{error ?? 'โหลดแคมเปญไม่สำเร็จ'}</p>
        <button type="button" onClick={retry}>
          ลองใหม่
        </button>
      </div>
    );
  }
  if (!campaign) return <p>ยังไม่มีแคมเปญ Flash Sale ขณะนี้</p>;

  return (
    <div>
      <FlashSaleBanner
        campaignId={campaign.id}
        title={campaign.title}
        endTime={campaign.endTime}
        items={campaign.items}
        onReserve={(productId) => reserve(productId)}
        onReserved={(productId, reservationToken, expiresAt) =>
          setHoldMsg(`จอง ${productId} สำเร็จ — ชำระใน 10 นาที (ถึง ${expiresAt})`)
        }
        onError={(m) => setHoldMsg(m)}
      />
      {holdMsg && <p role="status">{holdMsg}</p>}
      {error && <p role="alert">{error}</p>}
      {lock && <Link href={`/checkout?reservation=${encodeURIComponent(lock.reservationToken)}`}>ไปชำระเงิน PromptPay</Link>}
    </div>
  );
}

export default function LiffFlashSalePage() {
  return (
    <Suspense fallback={<p>กำลังโหลด Flash Sale…</p>}>
      <FlashSaleInner />
    </Suspense>
  );
}
