// SSOT Phase 077 §6.2 — Merchant batch booking studio (dep-free)
// Canonical: apps/frontend/components/fulfillment/BatchBookingPanel.tsx
// - Carrier CTA buttons with brand tokens; booking via REST with LOADING
//   progress; label URL opens in a new tab (R2 zero-egress).
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import { carrierBrand } from '@repo/shared';
import { logisticsApi } from '../../lib/logistics/logistics-client';

const CARRIERS = ['FLASH_EXPRESS', 'KERRY_EXPRESS', 'THAILAND_POST'] as const;

export function BatchBookingPanel({ slug }: { slug: string }) {
  const [orderIds, setOrderIds] = useState('');
  const [weight, setWeight] = useState(500);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function book(carrier: string) {
    const ids = orderIds.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      setMsg('ERROR: กรุณากรอก Order ID อย่างน้อย 1 รายการ');
      return;
    }
    setBusy(carrier);
    setMsg(null);
    try {
      const done: string[] = [];
      const failed: string[] = [];
      for (const orderId of ids) {
        try {
          const res = await logisticsApi(slug).book({ orderId, carrier, weightGrams: weight });
          done.push(res.trackingNumber);
          if (res.labelUrl) window.open(res.labelUrl, '_blank');
        } catch {
          failed.push(orderId.slice(0, 8));
        }
      }
      setMsg(
        failed.length === 0
          ? `จองสำเร็จ ${done.length} ใบ: ${done.join(', ')}`
          : `ERROR: สำเร็จ ${done.length}, ล้มเหลว ${failed.join(', ')} — ลองค่ายอื่นหรือกดจองซ้ำ`,
      );
    } catch (err) {
      setMsg(`ERROR: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="merchant-form">
        <input placeholder="Order IDs (คั่นด้วยจุลภาค)" value={orderIds} onChange={(e) => setOrderIds(e.target.value)} />
        <input type="number" placeholder="น้ำหนัก (กรัม)" value={weight} onChange={(e) => setWeight(Number(e.target.value) || 0)} />
      </div>
      <div className="merchant-form" style={{ flexDirection: 'row' }}>
        {CARRIERS.map((c) => {
          const brand = carrierBrand(c);
          return (
            <button
              key={c}
              type="button"
              disabled={busy !== null}
              onClick={() => void book(c)}
              style={{ background: brand.bg, color: brand.fg }}
            >
              {busy === c ? 'กำลังจอง…' : `จอง ${c === 'FLASH_EXPRESS' ? 'Flash' : c === 'KERRY_EXPRESS' ? 'Kerry' : 'ไปรษณีย์ไทย'}`}
            </button>
          );
        })}
      </div>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}
