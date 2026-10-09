// SSOT Phase 099 BDD-1/2 + Phase 101 §6.1 — LIFF live room entry (5-state)
// Canonical: apps/frontend/app/(liff)/live/[sessionId]/page.tsx
'use client';

import React, { Suspense } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useLiveSession } from '../../../../hooks/useLiveSession';
import { WebRtcIvsPlayer } from '../../../../components/live/WebRtcIvsPlayer';
import { LiveInteractionOverlay } from '../../../../components/live/LiveInteractionOverlay';

function LiveRoomInner() {
  const params = useParams();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
  const { status, error, access, retry } = useLiveSession(sessionId);

  if (status === 'LIFF_INIT' || status === 'LOADING') {
    return (
      <div aria-busy="true">
        <p>กำลังเชื่อมต่อสตรีมสด...</p>
      </div>
    );
  }

  if (status === 'ERROR' || !access) {
    return (
      <div>
        <p role="alert">{error ?? 'No access'}</p>
        <button type="button" onClick={retry}>
          ลองใหม่
        </button>
        <Link href="/catalog">ซื้อสิทธิ์เข้าชมทันที</Link>
      </div>
    );
  }

  return (
    <div>
      <p role="status">LIVE</p>
      <WebRtcIvsPlayer
        playbackUrl={access.playbackUrl}
        playbackToken={access.playbackToken}
        watermarkText={access.watermarkData.text}
      />
      {/* Phase 101 overlay (viewers + window-50 chat + stickers + raise + polls)
          replaces the 099 chat-only overlay on the same SSE transport. */}
      {access.playbackToken && (
        <LiveInteractionOverlay sessionId={access.sessionId} token={access.playbackToken} />
      )}
    </div>
  );
}

export default function LiffLiveRoomPage() {
  return (
    <Suspense fallback={<p>กำลังเตรียมห้องไลฟ์…</p>}>
      <LiveRoomInner />
    </Suspense>
  );
}
