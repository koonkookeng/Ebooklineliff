// SSOT Phase 016 Task 5 — LIFF order checkout page (QR + native photo picker)
// Canonical: apps/frontend/app/(liff)/checkout/[orderId]/page.tsx
// (legacy src/frontend/app/(liff)/checkout/[orderId]/page.tsx)
// Loads the order (IndexedDB last-known fallback offline), mints the
// fractional dynamic QR (Phase-013 engine), and composes PromptPayQrDisplay
// + SlipPhotoPicker per the spec IDLE matrix. Tenant theme via ?color=&logo=.
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { PromptPayQrDisplay } from '../../../../components/checkout/PromptPayQrDisplay';
import { SlipPhotoPicker } from '../../../../components/checkout/SlipPhotoPicker';
import { fetchOrderDetail, generateDynamicQR, type Order, type PromptPayQRPayload } from '../../../../lib/checkout';
import { readCachedOrderStatus, writeCachedOrderStatus } from '../../../../lib/slip-picker';

type UiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

function OrderCheckoutInner() {
  const params = useParams<{ orderId: string }>();
  const query = useSearchParams();
  const router = useRouter();
  const orderId = params.orderId;
  const tenantId = query.get('tenant') ?? '';
  const brandColor = query.get('color') ?? '#059669';
  const logoUrl = query.get('logo') ?? undefined;

  const [uiState, setUiState] = useState<UiState>('LIFF_INIT');
  const [order, setOrder] = useState<Order | null>(null);
  const [qr, setQr] = useState<PromptPayQRPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orderId) {
      setError('ไม่พบรหัสคำสั่งซื้อ');
      setUiState('ERROR');
      return;
    }
    setUiState('LIFF_INIT');
    setError(null);
    try {
      const detail = await fetchOrderDetail(orderId);
      setOrder(detail);
      void writeCachedOrderStatus({
        orderId: detail.id,
        orderStatus: String(detail.orderStatus),
        paymentStatus: String(detail.paymentStatus),
        netAmount: Number(detail.netAmount),
      });
      const payload = await generateDynamicQR({ orderId });
      setQr(payload);
      setUiState('IDLE');
    } catch (e) {
      // OFFLINE_FIRST: fall back to the last-known cached status.
      const cached = await readCachedOrderStatus(orderId);
      if (cached) {
        setOrder({ id: cached.orderId, orderStatus: cached.orderStatus, paymentStatus: cached.paymentStatus, netAmount: cached.netAmount } as Order);
        setError('ออฟไลน์: แสดงข้อมูลล่าสุดที่บันทึกไว้');
      } else {
        setError((e as Error).message || 'โหลดคำสั่งซื้อไม่สำเร็จ');
      }
      setUiState(cached ? 'IDLE' : 'ERROR');
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const success = useCallback(() => {
    setUiState('SUCCESS');
    setTimeout(() => router.push('/library'), 1500);
  }, [router]);

  if (uiState === 'LIFF_INIT') {
    return (
      <main className="mx-auto max-w-md px-4 py-6" aria-busy="true" style={{ ['--primary-color' as string]: brandColor }}>
        <div className="h-6 w-40 rounded bg-gray-100 animate-pulse mx-auto" />
        <div className="w-64 h-64 rounded-xl bg-gray-100 animate-pulse mx-auto mt-4" />
        <div className="h-24 rounded-xl bg-gray-100 animate-pulse mt-4" />
      </main>
    );
  }

  if (uiState === 'ERROR' && !order) {
    return (
      <main className="mx-auto max-w-md px-4 py-6">
        <div className="p-3 bg-red-50 text-red-600 text-xs rounded-lg" role="alert">{error}</div>
        <button type="button" onClick={() => void load()} className="mt-3 w-full py-3 text-white font-bold rounded-xl text-sm" style={{ background: brandColor }}>
          ลองใหม่อีกครั้ง
        </button>
      </main>
    );
  }

  if (uiState === 'SUCCESS') {
    return (
      <main className="mx-auto max-w-md px-4 py-6">
        <div className="flex flex-col items-center p-6 bg-white rounded-2xl shadow-xl text-center">
          <span className="w-16 h-16 rounded-full bg-emerald-100 text-4xl flex items-center justify-center">✓</span>
          <h3 className="mt-3 text-lg font-bold text-gray-900">ชำระเงินสำเร็จ</h3>
          <p className="text-sm text-gray-500 mt-1">กำลังนำท่านไปยังคลังเนื้อหา...</p>
        </div>
      </main>
    );
  }

  const netAmount = qr?.totalAmount ?? Number(order?.netAmount ?? 0);

  return (
    <main className="mx-auto max-w-md px-4 py-6 space-y-4" style={{ ['--primary-color' as string]: brandColor }}>
      {qr && (
        <div className="p-4 bg-white rounded-2xl shadow-xl border border-gray-100">
          <PromptPayQrDisplay
            qrPayload={qr.qrCodePayload}
            amount={qr.totalAmount}
            expiresAt={qr.expiresAt}
            brandColor={brandColor}
            logoUrl={logoUrl}
          />
        </div>
      )}
      {error && (
        <div className="p-3 bg-amber-50 text-amber-700 text-xs rounded-lg" role="status">{error}</div>
      )}
      <SlipPhotoPicker
        orderId={orderId}
        tenantId={tenantId}
        netAmount={netAmount}
        accentColor={brandColor}
        onSuccess={success}
      />
    </main>
  );
}

export default function OrderCheckoutPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-4 py-6" aria-busy="true"><div className="h-32 rounded-xl bg-gray-100 animate-pulse" /></main>}>
      <OrderCheckoutInner />
    </Suspense>
  );
}
