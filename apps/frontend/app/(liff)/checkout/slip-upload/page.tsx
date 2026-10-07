// SSOT Phase 032 Task 6 — LIFF slip-upload (permission-gated slip verify)
// Canonical: apps/frontend/app/(liff)/checkout/slip-upload/page.tsx
// (legacy src/frontend/app/(liff)/checkout/slip-upload/page.tsx)
// - BDD Scenario 1: PHOTO_LIBRARY pre-permission sheet (PDPA) → GRANTED →
//   SlipUploadZone (existing engine, untouched); camera offered as secondary
//   (§7.1 smart default: gallery first — higher opt-in on denial-prone devices).
// - Query: ?orderId=&tenantId=&amount=&tenant= (tenant display name).
'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SlipUploadZone } from '../../../../components/checkout/slip-upload-zone';
import { PermissionDialog } from '../../../../components/permissions/PermissionDialog';

function SlipUploadInner() {
  const params = useSearchParams();
  const orderId = params.get('orderId') ?? '';
  const tenantId = params.get('tenantId') ?? params.get('tenant') ?? 'default';
  const tenantName = params.get('tenantName') ?? 'แพลตฟอร์ม';
  const amount = Number(params.get('amount') ?? '0');
  const [source, setSource] = useState<'gallery' | 'camera'>('gallery');

  if (!orderId || !(amount > 0)) {
    return <div role="alert">ลิงก์อัปโหลดสลิปไม่สมบูรณ์ (orderId/amount)</div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-lg font-bold">อัปโหลดสลิปชำระเงิน</h1>
      <div className="flex gap-2" role="tablist" aria-label="แหล่งรูปภาพ">
        {(['gallery', 'camera'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={source === s}
            onClick={() => setSource(s)}
            className={`flex-1 rounded-xl border px-4 py-2 text-sm font-medium ${source === s ? 'border-emerald-600 text-emerald-700' : 'border-slate-200 text-slate-500'}`}
          >
            {s === 'gallery' ? 'เลือกจากอัลบั้ม (แนะนำ)' : 'ถ่ายภาพใหม่'}
          </button>
        ))}
      </div>

      <PermissionDialog
        key={source}
        permissionType={source === 'gallery' ? 'PHOTO_LIBRARY' : 'CAMERA'}
        purpose={`slip verification for order ${orderId}`}
        triggerLabel={source === 'gallery' ? 'เลือกภาพสลิป' : 'ถ่ายภาพสลิป'}
        tenantName={tenantName}
      >
        {() => (
          <SlipUploadZone
            orderId={orderId}
            tenantId={tenantId}
            expectedAmount={amount}
            onSuccessNavigateUrl={`/receipt/${orderId}?tenant=${encodeURIComponent(tenantId)}`}
          />
        )}
      </PermissionDialog>
    </div>
  );
}

export default function LiffSlipUploadPage() {
  return (
    <Suspense fallback={<div aria-busy>กำลังโหลดหน้าอัปโหลดสลิป...</div>}>
      <SlipUploadInner />
    </Suspense>
  );
}
