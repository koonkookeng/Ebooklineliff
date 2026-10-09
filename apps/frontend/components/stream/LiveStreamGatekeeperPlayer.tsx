// SSOT Phase 100 Task 6 — Gatekeeper player (native video + kick halt)
// Canonical: apps/frontend/components/stream/LiveStreamGatekeeperPlayer.tsx
// - RISK_CALL (§6.1 deviation): no HLS-JS/WS client libs (banned heavy deps) —
//   native <video> (Safari plays HLS directly; MSE ladder rides the 045/067
//   AdaptiveVideoPlayer where needed) + 15s heartbeat + SSE kick → instant
//   halt + buffer clear + paywall (BDD-2 <2s). Zero-dep (React).
'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { gateApi, sessionTokenOf } from '../../lib/stream/live-gatekeeper-client';
import { useLiveGatekeeper } from '../../hooks/useLiveGatekeeper';
import { DynamicLiveWatermark } from './DynamicLiveWatermark';

export function LiveStreamGatekeeperPlayer(props: { liveRoomId: string; userId: string }) {
  const { status, error, access, kickReason, onKicked } = useLiveGatekeeper(props.liveRoomId, props.userId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const beatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Attach stream + heartbeat loop once access is granted.
  useEffect(() => {
    const video = videoRef.current;
    if (status !== 'SUCCESS' || !access?.hlsStreamUrl || !video) return;
    video.src = access.hlsStreamUrl;
    void video.play().catch(() => undefined);

    const token = access.playbackToken ?? '';
    const sessionToken = sessionTokenOf(token);
    const tick = async () => {
      try {
        const r = await gateApi().heartbeat({
          sessionToken,
          liveRoomId: props.liveRoomId,
          currentPlaybackSec: video.currentTime,
        });
        if (r.status === 'KICKED') onKicked('SESSION_EXPIRED_OR_KICKED');
      } catch {
        // transient network — next beat retries (10s offline cap per §2.1)
      }
    };
    beatRef.current = setInterval(() => void tick(), (access.heartbeatIntervalSec || 15) * 1000);
    return () => {
      if (beatRef.current) clearInterval(beatRef.current);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function halt() {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }

  useEffect(() => {
    if (status === 'ERROR') halt();
  }, [status]);

  if (status === 'LIFF_INIT' || status === 'LOADING') {
    return (
      <div aria-busy="true">
        <p>กำลังตรวจสอบสิทธิ์การเข้าชมเรียลไทม์...</p>
      </div>
    );
  }

  if (status === 'ERROR' || !access) {
    const concurrent = kickReason === 'CONCURRENT_DEVICE_LOGIN';
    return (
      <div>
        <h3>การเข้าชมถูกระงับ (Access Denied)</h3>
        <p>
          {concurrent
            ? 'มีการเข้าสู่ระบบซ้อนจากอุปกรณ์อื่นด้วยบัญชีนี้'
            : kickReason ?? (error === 'GRANTED' ? 'Stream unavailable' : 'คุณไม่มีสิทธิ์เข้าชมไลฟ์สดนี้ หรือสิทธิ์หมดอายุแล้ว')}
        </p>
        <Link href={`/checkout?type=live&roomId=${props.liveRoomId}`}>สั่งซื้อแพ็กเกจ / ปลดล็อกสิทธิ์เข้าชม</Link>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000' }}>
      <video ref={videoRef} controls autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      <DynamicLiveWatermark payload={access.watermarkPayload} />
    </div>
  );
}

export default LiveStreamGatekeeperPlayer;
