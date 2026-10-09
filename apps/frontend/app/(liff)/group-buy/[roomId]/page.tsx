// SSOT Phase 090 Task 5 — Group room page (preview → join → reader)
// Canonical: apps/frontend/app/(liff)/group-buy/[roomId]/page.tsx
'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useGroupBuy } from '../../../../hooks/useGroupBuy';
import { BuddyPassShareCard } from '../../../../components/group-buying/BuddyPassShareCard';

function GroupRoomInner() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const { status, error, detail, completedProductId, join, retry } = useGroupBuy(roomId);
  const [busy, setBusy] = useState(false);

  async function onJoin() {
    setBusy(true);
    try {
      await join(`slip:${roomId}:${Date.now()}`);
    } finally {
      setBusy(false);
    }
  }

  if (status === 'LIFF_INIT' || status === 'LOADING') {
    return (
      <div aria-busy="true">
        <p>กำลังโหลดห้อง Group Buy…</p>
        <div>กำลังตรวจสอบสิทธิ์</div>
      </div>
    );
  }

  if (status === 'SUCCESS' && completedProductId) {
    return (
      <div>
        <p role="status">ห้องครบแล้ว ปลดล็อกสิทธิ์เรียบร้อย! 🎉</p>
        <Link href={`/reader/${completedProductId}`}>เริ่มอ่าน/เริ่มเรียนทันที</Link>
      </div>
    );
  }

  if (status === 'ERROR' || !detail) {
    return (
      <div>
        <p role="alert">{error ?? 'ห้องเต็มแล้วหรือหมดเวลา'}</p>
        <Link href="/store">สร้างห้องใหม่</Link>
        <button type="button" onClick={retry}>
          ลองใหม่
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={detail.coverImageUrl} alt={detail.productTitle} loading="lazy" />
      <h1>{detail.productTitle}</h1>
      <p>
        ฿{detail.discountedPrice} ({detail.currentMembersCount}/{detail.requiredMembers} คน)
      </p>
      <p>หมดเวลา {detail.expiresAt}</p>
      <button type="button" onClick={() => void onJoin()} disabled={busy || detail.status !== 'WAITING_FOR_MEMBERS'}>
        {busy ? 'กำลังเข้าร่วม…' : detail.status === 'WAITING_FOR_MEMBERS' ? '🎫 ชำระเงิน & เข้าร่วมห้อง' : `สถานะ: ${detail.status}`}
      </button>
      <BuddyPassShareCard
        roomId={detail.roomId}
        productTitle={detail.productTitle}
        discountedPrice={detail.discountedPrice}
        originalPrice={detail.originalPrice}
        expiresAt={detail.expiresAt}
        currentMembers={detail.currentMembersCount}
        requiredMembers={detail.requiredMembers}
        flexMessageJson={JSON.stringify({ invite: detail.roomId })}
        inviteUrl={`/group-buy/${detail.roomId}`}
      />
    </div>
  );
}

export default function LiffGroupRoomPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดห้อง Group Buy…</p>}>
      <GroupRoomInner />
    </Suspense>
  );
}
