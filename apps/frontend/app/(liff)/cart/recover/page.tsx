// SSOT Phase 084 Task 7 — Magic-link recovery entry (5-state)
// Canonical: apps/frontend/app/(liff)/cart/recover/page.tsx
// (011 owns (liff)/cart/page.tsx — this entry leaves it untouched.)
'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAbandonedCartRecovery } from '../../../../hooks/useAbandonedCartRecovery';
import { RecoverySheet } from '../../../../components/messaging/RecoverySheet';

function RecoverInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const token = params.get('token');
  const { status, payload, error, retry } = useAbandonedCartRecovery(slug, token);

  if (status === 'LIFF_INIT' || status === 'LOADING') {
    return (
      <div aria-busy="true">
        <div>กำลังกู้คืนตะกร้า…</div>
        <div>กำลังดึงรายการสินค้าและคูปอง</div>
      </div>
    );
  }

  if (status === 'ERROR' || !payload?.cartSession) {
    return (
      <div>
        <p role="alert">{error ?? payload?.message ?? 'กู้คืนไม่สำเร็จ'}</p>
        <Link href="/cart">เลือกซื้อสินค้าต่อ</Link>
        <button type="button" onClick={retry}>
          ลองใหม่
        </button>
      </div>
    );
  }

  return (
    <div>
      <p role="status">{payload.message}</p>
      <RecoverySheet session={payload.cartSession} />
    </div>
  );
}

export default function LiffCartRecoverPage() {
  return (
    <Suspense fallback={<p>กำลังกู้คืนตะกร้า…</p>}>
      <RecoverInner />
    </Suspense>
  );
}
