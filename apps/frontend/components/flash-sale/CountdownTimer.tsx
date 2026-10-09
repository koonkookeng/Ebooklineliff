// SSOT Phase 087 §6.1/Task 5 — Millisecond countdown (dep-free, <25MB)
// Canonical: apps/frontend/components/flash-sale/CountdownTimer.tsx
// - RISK_CALL: no framer-motion (§6.1 asks it) — rAF-driven text updates
//   only (no layout thrash, no animation lib); server endTime is truth.
// - Zero-dep (React only).
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { countdownParts } from '@repo/shared';

export function CountdownTimer({
  targetEndTime,
  onExpire,
  primaryColor = '#FF2E63',
}: {
  targetEndTime: string;
  onExpire?: () => void;
  primaryColor?: string;
}) {
  const [parts, setParts] = useState(() => countdownParts(Date.parse(targetEndTime)));
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      // ~25fps text updates (spec §6.1) without layout work.
      if (t - last >= 40) {
        last = t;
        const next = countdownParts(Date.parse(targetEndTime));
        setParts((prev) =>
          prev.hours === next.hours && prev.minutes === next.minutes && prev.seconds === next.seconds && prev.millis === next.millis
            ? prev
            : next,
        );
        if (next.expired && !firedRef.current) {
          firedRef.current = true;
          onExpire?.();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetEndTime]);

  return (
    <div role="timer" aria-label={`เหลือเวลา ${parts.hours}:${parts.minutes}:${parts.seconds}`}>
      <span>ENDS IN</span>
      <span>{parts.hours}</span>
      <span>:</span>
      <span>{parts.minutes}</span>
      <span>:</span>
      <span>{parts.seconds}</span>
      <span>:</span>
      <span style={{ backgroundColor: primaryColor }}>{parts.millis}</span>
    </div>
  );
}
