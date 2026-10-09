// SSOT Phase 102 BDD-2 — Live→VOD fallback player (<30MB RAM)
// Canonical: apps/frontend/components/stream/LivePlayerWithVODFallback.tsx
// - RISK_CALL (§6.1 deviation): native <video> (no HLS-JS lib — banned heavy
//   dep); LIVE → PROCESSING_VOD (2s status poll) → VOD_READY swaps src with
//   full peer/buffer GC. Watermark overlay inline (dep-free). Zero-dep.
'use client';

import React, { useEffect, useRef, useState } from 'react';

export type VodPlayerState = 'LIFF_INIT' | 'IDLE' | 'PROCESSING_VOD' | 'SUCCESS_VOD_READY' | 'ERROR';

async function vodStatus(lessonId: string): Promise<{ progressPct: number; status: string; hlsPlaylistUrl: string | null }> {
  const res = await fetch(`/api/v1/live-access/vod-status?lessonId=${encodeURIComponent(lessonId)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`vod ${res.status}`);
  return (await res.json().catch(() => null)) as { progressPct: number; status: string; hlsPlaylistUrl: string | null };
}

export function LivePlayerWithVODFallback(props: {
  lessonId: string;
  initialStreamUrl?: string;
  isLive: boolean;
  watermarkText: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<VodPlayerState>('LIFF_INIT');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Live phase: attach the live stream.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !props.isLive || !props.initialStreamUrl) {
      setState('PROCESSING_VOD');
      return;
    }
    setState('IDLE');
    video.src = props.initialStreamUrl;
    void video.play().catch(() => undefined);
    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialStreamUrl, props.isLive]);

  // VOD phase: poll until the ladder is ready, then hot-swap src.
  useEffect(() => {
    if (state !== 'PROCESSING_VOD') return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      try {
        const s = await vodStatus(props.lessonId);
        if (!alive) return;
        setProgress(s.progressPct);
        if (s.status === 'VOD_AVAILABLE' && s.hlsPlaylistUrl) {
          const video = videoRef.current;
          if (video) {
            // Strict GC: drop live buffers before mounting VOD (<30MB).
            video.pause();
            video.removeAttribute('src');
            video.load();
            video.src = s.hlsPlaylistUrl;
            void video.play().catch(() => undefined);
          }
          setState('SUCCESS_VOD_READY');
          if (timer) clearInterval(timer);
        }
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
        setState('ERROR');
        if (timer) clearInterval(timer);
      }
    };
    void poll();
    timer = setInterval(() => void poll(), 2000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [state, props.lessonId]);

  function retry() {
    setError(null);
    setState('PROCESSING_VOD');
  }

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000' }}>
      <video ref={videoRef} controls playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.25,
        }}
      >
        <span style={{ color: '#fff', font: '12px monospace', letterSpacing: 2 }}>
          {props.watermarkText} • {new Date().toISOString().substring(0, 10)}
        </span>
      </div>
      {state === 'PROCESSING_VOD' && (
        <div role="status">
          <p>กำลังแปลงไฟล์ไลฟ์เป็นบทเรียน VOD ย้อนหลัง... {progress}%</p>
        </div>
      )}
      {state === 'ERROR' && (
        <div>
          <p role="alert">{error ?? 'Transcoding failed'}</p>
          <button type="button" onClick={retry}>
            ลองใหม่อีกครั้ง
          </button>
        </div>
      )}
    </div>
  );
}

export default LivePlayerWithVODFallback;
