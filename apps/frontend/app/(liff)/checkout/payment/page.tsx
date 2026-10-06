// SSOT Phase 015 §6 — LIFF payment page (dynamic QR + slip dropzone, 5 states)
// Canonical: apps/frontend/app/(liff)/checkout/payment/page.tsx
// Takes ?orderId=&tenant=&amount= ; QR via PromptPayQRWidget (fractional +
// TTL + regenerate), slip via SlipUploadZone (compressed atomic verify).
'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PromptPayQRWidget } from '../../../../components/checkout/PromptPayQRWidget';
import { SlipUploadZone } from '../../../../components/checkout/slip-upload-zone';

type UiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

function LiffPaymentInner() {
  const params = useSearchParams();
  const orderId = params.get('orderId') ?? '';
  const tenantId = params.get('tenant') ?? '';
  const amount = Number(params.get('amount') ?? '0');
  const [uiState] = useState<UiState>(orderId ? 'IDLE' : 'ERROR');

  if (!orderId) {
    return (
      <main className="mx-auto max-w-md px-4 py-6">
        <div className="p-3 bg-red-50 text-red-600 text-xs rounded-lg" role="alert">
          ไม่พบคำสั่งซื้อ กรุณากลับไปหน้า checkout
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-6 space-y-4" data-ui-state={uiState}>
      <PromptPayQRWidget orderId={orderId} />
      <SlipUploadZone
        orderId={orderId}
        tenantId={tenantId}
        expectedAmount={Number.isFinite(amount) ? amount : 0}
        onSuccessNavigateUrl="/library"
      />
    </main>
  );
}

export default function LiffPaymentPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-4 py-6" aria-busy="true"><div className="h-32 rounded-xl bg-gray-100 animate-pulse" /></main>}>
      <LiffPaymentInner />
    </Suspense>
  );
}
