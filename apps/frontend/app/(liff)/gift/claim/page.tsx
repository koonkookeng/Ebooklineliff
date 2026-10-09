// SSOT Phase 089 Task 6 — Gift claim page (preview → claim → reader)
// Canonical: apps/frontend/app/(liff)/gift/claim/page.tsx
'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useGiftClaim } from '../../../../hooks/useGiftClaim';

function GiftClaimInner() {
  const params = useSearchParams();
  const code = params.get('code');
  const { status, error, detail, claimedProductId, claim, retry } = useGiftClaim(code);
  const [busy, setBusy] = useState(false);

  async function onClaim() {
    setBusy(true);
    try {
      await claim();
    } finally {
      setBusy(false);
    }
  }

  if (status === 'LIFF_INIT' || status === 'LOADING') {
    return (
      <div aria-busy="true">
        <p>กำลังแกะกล่องของขวัญ…</p>
        <div>กำลังตรวจสอบสิทธิ์</div>
      </div>
    );
  }

  if (status === 'SUCCESS' && claimedProductId) {
    return (
      <div>
        <p role="status">รับของขวัญสำเร็จ! 🎉</p>
        <Link href={`/reader/${claimedProductId}`}>เข้าอ่าน/เรียนทันที</Link>
      </div>
    );
  }

  if (status === 'ERROR' || !detail) {
    return (
      <div>
        <p role="alert">{error ?? 'ของขวัญชิ้นนี้ถูกรับไปแล้ว'}</p>
        <Link href="/store">เลือกซื้อของขวัญชิ้นใหม่</Link>
        <button type="button" onClick={retry}>
          ลองใหม่
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={detail.productCoverUrl} alt={detail.productTitle} loading="lazy" />
      <h1>{detail.productTitle}</h1>
      <p>“{detail.greetingMessage}”</p>
      <p>จาก {detail.senderName}</p>
      <button type="button" onClick={() => void onClaim()} disabled={busy || detail.status !== 'READY_TO_CLAIM'}>
        {busy ? 'กำลังรับ…' : detail.status === 'READY_TO_CLAIM' ? '🎁 กดรับของขวัญ' : `สถานะ: ${detail.status}`}
      </button>
    </div>
  );
}

export default function LiffGiftClaimPage() {
  return (
    <Suspense fallback={<p>กำลังแกะกล่องของขวัญ…</p>}>
      <GiftClaimInner />
    </Suspense>
  );
}
