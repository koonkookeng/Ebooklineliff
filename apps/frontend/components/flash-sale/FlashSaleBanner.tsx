// SSOT Phase 087 Task 5 — Flash sale banner + reserve CTA (dep-free)
// Canonical: apps/frontend/components/flash-sale/FlashSaleBanner.tsx
// - Tenant vars (§2.1); reserve locks the button <300ms (Gate: LOADING).
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import { CountdownTimer } from './CountdownTimer';

export interface FlashBannerItem {
  productId: string;
  productTitle: string;
  coverImageUrl: string;
  originalPrice: number;
  flashSalePrice: number;
  remainingStock: number;
  discountPercentage: number;
}

export function FlashSaleBanner(props: {
  campaignId: string;
  title: string;
  endTime: string;
  items: FlashBannerItem[];
  onReserve: (productId: string) => Promise<{ reservationToken: string | null; expiresAt: string | null }>;
  onReserved: (productId: string, reservationToken: string, expiresAt: string) => void;
  onError: (message: string) => void;
}) {
  const { campaignId, title, endTime, items, onReserve, onReserved, onError } = props;
  const [busyId, setBusyId] = useState<string | null>(null);
  void campaignId;

  async function reserve(item: FlashBannerItem) {
    if (busyId) return;
    setBusyId(item.productId);
    try {
      const r = await onReserve(item.productId);
      if (r.reservationToken && r.expiresAt) onReserved(item.productId, r.reservationToken, r.expiresAt);
      else onError('จองไม่สำเร็จ — สินค้าอาจหมดแล้ว');
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section style={{ background: 'var(--flash-primary-color,#FF2E63)' }}>
      <h2>{title}</h2>
      <CountdownTimer targetEndTime={endTime} />
      <ul>
        {items.map((i) => (
          <li key={i.productId}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={i.coverImageUrl} alt={i.productTitle} loading="lazy" />
            <span>-{i.discountPercentage}%</span>
            <span>{i.productTitle}</span>
            <span>฿{i.flashSalePrice.toLocaleString('th-TH')}</span>
            <span>เหลือ {i.remainingStock}</span>
            <button
              type="button"
              disabled={busyId === i.productId || i.remainingStock <= 0}
              onClick={() => void reserve(i)}
            >
              {busyId === i.productId ? 'กำลังจอง…' : i.remainingStock <= 0 ? 'สินค้าหมดแล้ว' : 'จองด่วน'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
