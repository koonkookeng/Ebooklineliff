// SSOT Phase 077 §2.2 — LIFF Order History (Mobile-First, <25MB)
// Canonical: apps/frontend/app/(liff)/orders/page.tsx
'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchUserOrders, type Order } from '../../../lib/checkout';
import { OrderList } from '../../../components/orders/OrderList';

function LiffOrdersInner() {
  const params = useSearchParams();
  const tenantId = params.get('tenant') ?? undefined;
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUserOrders(tenantId)
      .then(setOrders)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (loading) return <div className="p-8 text-center bg-background min-h-screen">กำลังโหลดรายการคำสั่งซื้อ...</div>;
  if (error) return <div className="p-8 text-center text-red-500 bg-background min-h-screen">{error}</div>;

  return (
    <div className="min-h-screen bg-background">
      <div className="p-4">
        <h1 className="text-xl font-bold">คำสั่งซื้อของฉัน</h1>
      </div>
      <OrderList orders={orders} />
      <div className="h-20" /> {/* Safe area for bottom nav */}
    </div>
  );
}

export default function LiffOrdersPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center bg-background min-h-screen">กำลังโหลด...</div>}>
      <LiffOrdersInner />
    </Suspense>
  );
}
