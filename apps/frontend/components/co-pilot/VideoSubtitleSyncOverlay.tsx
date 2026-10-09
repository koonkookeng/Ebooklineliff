// SSOT Phase 094 §6.1 — Subtitle sync overlay (rAF, single-caption DOM node)
// Canonical: apps/frontend/components/co-pilot/VideoSubtitleSyncOverlay.tsx
// - requestAnimationFrame loop renders only the active cue (one DOM node —
//   Gate 5); cancels on unmount (no leaks). Zero-dep (React only).
'use client';

import React, { useEffect, useRef, useState, type RefObject } from 'react';
import type { SubtitleCue } from '../../lib/co-pilot/co-pilot-client';

export function VideoSubtitleSyncOverlay(props: {
  videoRef: RefObject<HTMLVideoElement | null>;
  subtitles: SubtitleCue[];
}) {
  const { videoRef, subtitles } = props;
  const [currentText, setCurrentText] = useState('');
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const updateCaption = (): void => {
      const el = videoRef.current;
      if (el) {
        const t = el.currentTime;
        const active = subtitles.find((s) => t >= s.startTimeSec && t < s.endTimeSec);
        const text = active ? active.text : '';
        setCurrentText((prev) => (prev === text ? prev : text));
      }
      animFrameRef.current = requestAnimationFrame(updateCaption);
    };
    animFrameRef.current = requestAnimationFrame(updateCaption);
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    };
  }, [videoRef, subtitles]);

  if (!currentText) return null;
  return <div aria-live="polite">{currentText}</div>;
}

export default VideoSubtitleSyncOverlay;
