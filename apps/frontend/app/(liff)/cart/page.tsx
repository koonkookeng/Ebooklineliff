// SSOT Phase 011 §6 — LIFF hybrid cart page (hydrate + refresh, 5 states via store)
'use client';

import React, { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { HybridCartDrawer } from '../../../components/cart/HybridCartDrawer';
import { cartStore } from '../../../stores/useCartStore';

function LiffCartInner() {
  const params = useSearchParams();
  const shippingAddressId = params.get('shippingAddressId') ?? undefined;

  useEffect(() => {
    cartStore.hydrate();
    void cartStore.refresh(shippingAddressId);
  }, [shippingAddressId]);

  return <HybridCartDrawer />;
}

export default function LiffCartPage() {
  return (
    <Suspense fallback={<HybridCartDrawer />}>
      <LiffCartInner />
    </Suspense>
  );
}
