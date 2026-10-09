// SSOT Phase 099 Task 4 — Low-latency live player (native video, <30MB RAM)
// Canonical: apps/frontend/components/live/WebRtcIvsPlayer.tsx
// - RISK_CALL (§6.1 deviation): no vendor WASM player SDK (heavy dep banned
//   from LIFF) — native <video> plays the HLS/IVS URL; watermark rides a DOM
//   overlay (rAF Lissajous drift, teardown on unmount). Zero-dep (React).
'use client';

import React, { useEffect, useRef, useState } from 'react';

export function WebRtcIvsPlayer(props: { playbackUrl: string; playbackToken?: string; watermarkText: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const src = props.playbackToken ? `${props.playbackUrl}?token=${encodeURIComponent(props.playbackToken)}` : props.playbackUrl;
    video.src = src;
    const onPlay = () => setPlaying(true);
    video.addEventListener('play', onPlay);
    void video.play().catch(() => undefined);

    // Forensic watermark drift (Lissajous, GPU-composited transform only).
    let raf = 0;
    const drift = () => {
      if (markRef.current) {
        const t = Date.now() / 2000;
        markRef.current.style.transform = `translate(${Math.sin(t) * 15}px, ${Math.cos(t) * 15}px)`;
      }
      raf = requestAnimationFrame(drift);
    };
    raf = requestAnimationFrame(drift);
    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener('play', onPlay);
      video.pause();
      video.removeAttribute('src');
      video.load();
      setPlaying(false);
    };
  }, [props.playbackUrl, props.playbackToken]);

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000' }}>
      <video ref={videoRef} playsInline autoPlay muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <div
        ref={markRef}
        aria-hidden="true"
        style={{
          position: 'absolute', left: 20, top: 50, pointerEvents: 'none', zIndex: 10,
          font: '12px monospace', color: 'rgba(255,255,255,0.25)', whiteSpace: 'pre',
        }}
      >
        {props.watermarkText}
        {'\n'}
        {new Date().toISOString()}
      </div>
      {!playing && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
          <span>กำลังเชื่อมต่อสตรีมสด...</span>
        </div>
      )}
    </div>
  );
}

export default WebRtcIvsPlayer;
