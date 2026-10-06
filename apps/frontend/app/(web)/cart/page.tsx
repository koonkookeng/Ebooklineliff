// SSOT Phase 011 §6 — Web hybrid cart page (mirrors LIFF, centered column)
'use client';

import React, { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { HybridCartDrawer } from '../../../components/cart/HybridCartDrawer';
import { cartStore } from '../../../stores/useCartStore';

function WebCartInner() {
  const params = useSearchParams();
  const shippingAddressId = params.get('shippingAddressId') ?? undefined;

  useEffect(() => {
    cartStore.hydrate();
    void cartStore.refresh(shippingAddressId);
  }, [shippingAddressId]);

  return (
    <main className="mx-auto max-w-2xl">
      <HybridCartDrawer />
    </main>
  );
}

export default function WebCartPage() {
  return (
    <Suspense fallback={<HybridCartDrawer />}>
      <WebCartInner />
    </Suspense>
  );
}
