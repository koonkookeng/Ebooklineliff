// SSOT Phase 090 Task 5 — Buddy pass share card (dep-free)
// Canonical: apps/frontend/components/group-buying/BuddyPassShareCard.tsx
// - RISK_CALL: no shadcn/lucide/@line/liff (spec asks them) — native
//   elements + window.liff keep LIFF RAM <30MB (Gate 5). Share rides
//   window.liff with clipboard fallback (026/079/080/089 precedent).
// - Zero-dep (React only).
'use client';

import React, { useState } from 'react';

interface LiffGlobal {
  isApiAvailable(api: string): boolean;
  shareTargetPicker(messages: unknown[]): Promise<{ status: string } | null>;
}

function liffGlobal(): LiffGlobal | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { liff?: LiffGlobal }).liff ?? null;
}

export function BuddyPassShareCard(props: {
  roomId: string;
  productTitle: string;
  discountedPrice: number;
  originalPrice: number;
  expiresAt: string;
  currentMembers: number;
  requiredMembers: number;
  flexMessageJson: string;
  inviteUrl: string;
  onShared?: () => void;
}) {
  const {
    productTitle,
    discountedPrice,
    originalPrice,
    currentMembers,
    requiredMembers,
    flexMessageJson,
    inviteUrl,
    onShared,
  } = props;
  const [isSharing, setIsSharing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const remaining = Math.max(0, requiredMembers - currentMembers);

  async function handleLineFlexShare() {
    if (isSharing) return;
    setIsSharing(true);
    setMsg(null);
    try {
      const liff = liffGlobal();
      if (liff?.isApiAvailable('shareTargetPicker')) {
        const out = await liff.shareTargetPicker([JSON.parse(flexMessageJson) as unknown]);
        setMsg(out ? 'ส่งคำชวนให้เพื่อนเรียบร้อยแล้ว!' : 'ยกเลิกการแชร์');
        if (out) onShared?.();
      } else {
        await navigator.clipboard.writeText(inviteUrl).catch(() => undefined);
        setMsg('คัดลอกลิงก์ชวนเพื่อนเรียบร้อยแล้ว ส่งให้เพื่อนผ่านแชตได้ทันที!');
        onShared?.();
      }
    } catch (e) {
      setMsg(`ERROR: ${(e as Error).message}`);
    } finally {
      setIsSharing(false);
    }
  }

  return (
    <div>
      <div>
        <span>Buddy Pass Room Active</span>
        <h3>{productTitle}</h3>
        <p>
          ฿{discountedPrice.toLocaleString('th-TH')}{' '}
          <s>฿{originalPrice.toLocaleString('th-TH')}</s>
        </p>
      </div>
      <div>
        <p>สถานะกลุ่มปัจจุบัน</p>
        <p>
          เข้าร่วมแล้ว {currentMembers}/{requiredMembers} คน
        </p>
        <p>ต้องการอีกเพียง {remaining} คนเพื่อปลดล็อกสิทธิ์!</p>
      </div>
      <button type="button" onClick={() => void handleLineFlexShare()} disabled={isSharing}>
        {isSharing ? 'กำลังเปิด LINE Share...' : 'ส่ง Flex Message ชวนเพื่อนใน LINE'}
      </button>
      {msg && <p role={msg.startsWith('ERROR') ? 'alert' : 'status'}>{msg}</p>}
    </div>
  );
}

export default BuddyPassShareCard;
