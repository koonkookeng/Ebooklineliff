// SSOT Phase 083 Task 8 — Reward catalog drawer + atomic redeem UI (dep-free)
// Canonical: apps/frontend/components/reward/RewardCatalogDrawer.tsx
// - Real-time availability (published + stock + affordable); redeem posts
//   the atomic 083 endpoint and surfaces entitlement + code (<500ms).
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';
import { gameApi, type RewardCatalogItem } from '../../lib/gamification/gamification-client';

export function RewardCatalogDrawer({
  slug,
  items,
  walletPoints,
  onRedeemed,
}: {
  slug: string;
  items: RewardCatalogItem[];
  walletPoints: number;
  onRedeemed: (remainingPoints: number) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function redeem(item: RewardCatalogItem) {
    if (busyId) return;
    setBusyId(item.id);
    setMsg(null);
    try {
      const res = await gameApi(slug).redeem({ rewardItemId: item.id });
      setMsg(`แลกสำเร็จ! โค้ด ${res.redemptionCode}${res.entitlementGranted ? ' · ปลดล็อกสิทธิ์แล้ว' : ''}`);
      onRedeemed(res.remainingPoints);
    } catch (e) {
      setMsg(`ERROR: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <h2>แค็ตตาล็อกของรางวัล</h2>
      <ul>
        {items.map((i) => {
          const ok = i.isPublished && i.stockQty > 0 && walletPoints >= i.pointsRequired;
          return (
            <li key={i.id}>
              <span>{i.title}</span>
              <span>{i.pointsRequired} แต้ม · เหลือ {i.stockQty}</span>
              <button type="button" disabled={!ok || busyId === i.id} onClick={() => void redeem(i)}>
                {busyId === i.id ? 'กำลังแลก…' : ok ? 'แลกเลย' : 'แต้มไม่พอ/หมด'}
              </button>
            </li>
          );
        })}
        {items.length === 0 && <li>ยังไม่มีของรางวัล</li>}
      </ul>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </section>
  );
}
