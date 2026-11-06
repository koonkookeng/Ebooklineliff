// SSOT Phase 077 §1 — Order History List (Tabbed, Responsive, <30MB)
// Canonical: apps/frontend/components/orders/OrderList.tsx
'use client';

import React, { useState } from 'react';
import type { Order } from '../../lib/checkout';
import { OrderStatusEnumFromOrder as OrderStatusEnum } from '@repo/shared';

type TabType = 'ALL' | 'PENDING' | 'SHIPPING' | 'COMPLETED' | 'CANCELLED';

const TABS: { label: string; value: TabType }[] = [
  { label: 'ทั้งหมด', value: 'ALL' },
  { label: 'รอชำระ', value: 'PENDING' },
  { label: 'กำลังจัดส่ง', value: 'SHIPPING' },
  { label: 'สำเร็จแล้ว', value: 'COMPLETED' },
  { label: 'ยกเลิก', value: 'CANCELLED' },
];

const STATUS_MAP: Record<TabType, string[]> = {
  ALL: [],
  PENDING: [OrderStatusEnum.enum.PENDING_PAYMENT, OrderStatusEnum.enum.PAYMENT_VERIFYING],
  SHIPPING: [OrderStatusEnum.enum.PROCESSING, OrderStatusEnum.enum.SHIPPED],
  COMPLETED: [OrderStatusEnum.enum.DELIVERED, OrderStatusEnum.enum.COMPLETED],
  CANCELLED: [OrderStatusEnum.enum.CANCELLED, OrderStatusEnum.enum.REFUNDED, OrderStatusEnum.enum.EXPIRED],
};

export function OrderList({ orders }: { orders: Order[] }) {
  const [activeTab, setActiveTab] = useState<TabType>('ALL');

  const filtered = orders.filter((o) => {
    if (activeTab === 'ALL') return true;
    return STATUS_MAP[activeTab].includes(o.orderStatus);
  });

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex border-b border-border sticky top-0 bg-background z-10">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setActiveTab(t.value)}
            className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${
              activeTab === t.value ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 px-4 lg:px-0">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">ไม่มีรายการคำสั่งซื้อ</div>
        ) : (
          filtered.map((order) => (
            <div
              key={order.id}
              className="p-4 bg-card border border-border rounded-xl shadow-sm hover:border-primary/30 transition-all flex flex-col gap-3"
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-xs text-muted-foreground">เลขที่คำสั่งซื้อ</div>
                  <div className="font-mono text-sm font-bold">{order.orderNumber}</div>
                </div>
                <div className="text-right">
                  <div className={`text-xs px-2 py-1 rounded-full font-medium ${getStatusColor(order.orderStatus)}`}>
                    {order.orderStatus}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(order.createdAt).toLocaleDateString('th-TH')}
                  </div>
                </div>
              </div>

              <div className="space-y-2 border-y border-border/50 py-3">
                {order.orderItems.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <span className="truncate flex-1 pr-4">{item.productTitle}</span>
                    <span className="text-muted-foreground">x{item.quantity}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center pt-1">
                <div className="text-sm font-bold text-primary">฿{order.netAmount.toLocaleString()}</div>
                <div className="flex gap-2">
                  <a
                    href={`/orders/${order.id}/tracking`}
                    className="text-xs px-3 py-2 rounded-lg border border-border hover:bg-muted"
                  >
                    ติดตามพัสดุ
                  </a>
                  {isDigital(order) && order.orderStatus === 'COMPLETED' && (
                    <button className="text-xs px-3 py-2 rounded-lg bg-primary text-white font-bold">
                      เข้าชม/อ่านเลย
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function getStatusColor(status: string) {
  switch (status) {
    case 'PENDING_PAYMENT': return 'bg-yellow-100 text-yellow-800';
    case 'PAYMENT_VERIFYING': return 'bg-blue-100 text-blue-800';
    case 'PROCESSING': return 'bg-purple-100 text-purple-800';
    case 'SHIPPED': return 'bg-orange-100 text-orange-800';
    case 'DELIVERED':
    case 'COMPLETED': return 'bg-green-100 text-green-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}

function isDigital(order: Order) {
  return order.orderItems.some(i => i.productType !== 'PHYSICAL_BOOK');
}
