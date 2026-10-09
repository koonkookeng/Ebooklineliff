// SSOT Phase 097 BDD-2 — Corporate claim card (dep-free, LIFF-first)
// Canonical: apps/frontend/components/b2b/CorporateClaimCard.tsx
// - RISK_CALL: no shadcn/lucide (spec asks them) — native elements keep
//   LIFF RAM <30MB (Gate 5). Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useCorporateClaim } from '../../hooks/useCorporateClaim';

export function CorporateClaimCard(props: { code: string }) {
  const { status, error, info, result, claim, retry } = useCorporateClaim(props.code);
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
        <p>กำลังตรวจสอบและอนุมัติสิทธิ์...</p>
      </div>
    );
  }

  if (status === 'SUCCESS' && result) {
    return (
      <div>
        <p role="status">อนุมัติสิทธิ์เรียบร้อยแล้ว!</p>
        <Link href="/my-library">ไปยังคลังของฉัน</Link>
      </div>
    );
  }

  if (status === 'ERROR' || !info) {
    return (
      <div>
        <p role="alert">{error ?? 'สิทธิ์เต็มแล้ว กรุณาติดต่อ HR ของท่าน'}</p>
        <button type="button" onClick={retry}>
          ลองใหม่
        </button>
      </div>
    );
  }

  return (
    <div>
      <p>🏢 {info.companyName}</p>
      <h1>องค์กรมอบสิทธิ์เข้าเรียนให้คุณ</h1>
      <p>
        {info.productTitle} · เหลือ {info.remainingSeats}/{info.totalSeats} ที่นั่ง
      </p>
      <button type="button" onClick={() => void onClaim()} disabled={busy || info.remainingSeats <= 0}>
        {busy ? 'กำลังรับสิทธิ์…' : 'รับสิทธิ์เข้าใช้งานทันที'}
      </button>
    </div>
  );
}

export default CorporateClaimCard;
