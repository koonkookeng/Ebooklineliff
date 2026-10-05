'use client';
/**
 * Phase 000 — HLS player: R2 segments + entitlement gate + progress heatmap sync every 5s.
 */
import { useEffect, useRef, useState } from 'react';

type UiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export default function HlsVideoPlayer({ lessonId, src }: { lessonId: string; src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ui, setUi] = useState<UiState>('IDLE');
  const watchedSec = useRef(0);

  useEffect(() => {
    setUi('LOADING');
    const v = videoRef.current;
    if (!v) return;
    v.src = src;
    const onCanPlay = () => setUi('SUCCESS');
    const onErr = () => setUi('ERROR');
    const onTime = () => {
      watchedSec.current = Math.floor(v.currentTime);
    };
    v.addEventListener('canplay', onCanPlay);
    v.addEventListener('error', onErr);
    v.addEventListener('timeupdate', onTime);
    // Heatmap sync every 5s -> Redis via API
    const t = setInterval(() => {
      fetch('/api/stream/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lessonId, watchedSec: watchedSec.current }),
      }).catch(() => undefined);
    }, 5000);
    return () => {
      clearInterval(t);
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('error', onErr);
      v.removeEventListener('timeupdate', onTime);
    };
  }, [lessonId, src]);

  if (ui === 'ERROR') return <div role="alert">Video failed <button onClick={() => setUi('IDLE')}>Retry</button></div>;
  return <video ref={videoRef} controls playsInline preload="metadata" aria-label={`lesson ${lessonId}`} />;
}
