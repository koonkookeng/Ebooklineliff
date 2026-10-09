// SSOT Phase 100 Task 7 — Dynamic forensic watermark (5s reposition)
// Canonical: apps/frontend/components/stream/DynamicLiveWatermark.tsx
// - Forensic triple (hash/display/IP) hopping quadrants every 5s (§8.2);
//   rAF-free interval, GPU-composited transition. Zero-dep (React).
'use client';

import React, { useEffect, useState } from 'react';

export function DynamicLiveWatermark(props: {
  payload: { userIdHash: string; displayName: string; ipAddress: string; timestamp: string };
}) {
  const [position, setPosition] = useState({ top: 10, left: 10 });

  useEffect(() => {
    const interval = setInterval(() => {
      setPosition({
        top: Math.floor(Math.random() * 70) + 5,
        left: Math.floor(Math.random() * 65) + 5,
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: `${position.top}%`,
        left: `${position.left}%`,
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: 50,
        opacity: 0.25,
        font: '11px monospace',
        color: 'rgba(255,255,255,0.7)',
        background: 'rgba(0,0,0,0.4)',
        padding: '4px 8px',
        borderRadius: 4,
        transition: 'top 1s ease-in-out, left 1s ease-in-out',
      }}
    >
      <div>ID: {props.payload.userIdHash}</div>
      <div>USER: {props.payload.displayName}</div>
      <div>IP: {props.payload.ipAddress}</div>
    </div>
  );
}

export default DynamicLiveWatermark;
