// SSOT Phase 012 §6 — LIFF checkout page (cart summary → order → PromptPay modal)
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PromptPayQrModal } from '../../../components/payment/PromptPayQrModal';
import { fetchSmartCart } from '../../../lib/cart';
import { createSmartOrder, type CreateOrderPayload } from '../../../lib/checkout';
import type { HybridCartSplitSummary } from '@repo/shared';

type UiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

function LiffCheckoutInner() {
  const params = useSearchParams();
  const tenantId = params.get('tenant') ?? '';
  const [cart, setCart] = useState<HybridCartSplitSummary | null>(null);
  const [order, setOrder] = useState<CreateOrderPayload | null>(null);
  const [uiState, setUiState] = useState<UiState>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const data = await fetchSmartCart();
        if (live) {
          setCart(data);
          setUiState('IDLE');
        }
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          setUiState('ERROR');
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const confirm = useCallback(async () => {
    if (!cart || !tenantId) {
      setError('ข้อมูลตะกร้าหรือร้านค้าไม่ครบถ้วน');
      setUiState('ERROR');
      return;
    }
    setUiState('LOADING');
    setError(null);
    try {
      const items = [...cart.digitalItems, ...cart.physicalItems].map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      }));
      const payload = await createSmartOrder({ tenantId, items });
      setOrder(payload);
      setUiState('SUCCESS');
    } catch (e) {
      setError((e as Error).message);
      setUiState('ERROR');
    }
  }, [cart, tenantId]);

  if (uiState === 'LIFF_INIT') {
    return (
      <main className="mx-auto max-w-md px-4 py-6" aria-busy="true">
        <div className="h-6 w-40 rounded bg-gray-100 animate-pulse" />
        <div className="mt-4 h-32 rounded-xl bg-gray-100 animate-pulse" />
      </main>
    );
  }

  if (uiState === 'SUCCESS' && order) {
    return (
      <main className="mx-auto max-w-md px-4 py-6">
        <PromptPayQrModal orderId={order.orderId} qrPayload={order.promptPayQrPayload} amount={order.netAmount} expiresAt={order.expiresAt} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-6 pb-28">
      <h1 className="text-lg font-bold">ยืนยันคำสั่งซื้อ</h1>
      {cart && (
        <div className="mt-4 rounded-xl border p-4 text-sm space-y-1">
          <div className="flex justify-between"><span>ดิจิทัล ({cart.digitalItems.length})</span><span>฿{cart.digitalSubtotal.toLocaleString()}</span></div>
          <div className="flex justify-between"><span>สินค้าจริง ({cart.physicalItems.length})</span><span>฿{cart.physicalSubtotal.toLocaleString()}</span></div>
          <div className="flex justify-between"><span>ค่าจัดส่ง</span><span>{cart.estimatedShippingFee === 0 ? '—' : `฿${cart.estimatedShippingFee.toLocaleString()}`}</span></div>
          <div className="flex justify-between font-bold text-base pt-2 border-t"><span>รวมสุทธิ</span><span className="text-emerald-600">฿{cart.grandTotalAmount.toLocaleString()}</span></div>
        </div>
      )}
      {error && (
        <div className="mt-3 p-3 bg-red-50 text-red-600 text-xs rounded-lg" role="alert">{error}</div>
      )}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t">
        <div className="max-w-md mx-auto">
          <button
            type="button"
            onClick={confirm}
            disabled={uiState === 'LOADING' || !cart || cart.grandTotalAmount <= 0}
            className="w-full py-3 bg-emerald-600 disabled:opacity-50 text-white font-bold rounded-xl text-sm"
          >
            {uiState === 'LOADING' ? 'กำลังสร้างคำสั่งซื้อ...' : 'ยืนยันการสั่งซื้อ'}
          </button>
        </div>
      </div>
    </main>
  );
}

export default function LiffCheckoutPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-4 py-6" aria-busy="true"><div className="h-32 rounded-xl bg-gray-100 animate-pulse" /></main>}>
      <LiffCheckoutInner />
    </Suspense>
  );
}
