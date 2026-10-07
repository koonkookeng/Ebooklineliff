// SSOT Phase 040 §8.2 — ForensicWatermark (CSS overlay layer)
// Canonical: apps/frontend/components/reader/watermark/ForensicWatermark.tsx
// (legacy src/frontend/components/reader/watermark/ForensicWatermark.tsx)
// - Presentational DOM overlay (no canvas dependency): tiled, rotated,
//   semi-transparent license text + user hash. pointer-events-none +
//   aria-hidden so it never traps gestures (Anti-Screenshot Layer pairs with
//   the canvas blitted watermark from the reader engine).
// - Deterministic tile positions (seeded by userIdHash) so screenshots carry
//   a stable forensic fingerprint per reader.
'use client';

import { useMemo } from 'react';

interface ForensicWatermarkProps {
  watermarkText: string;
  userIdHash: string;
  tileCount?: number;
}

function seedFrom(hash: string): number {
  let seed = 0;
  for (let i = 0; i < hash.length; i += 1) seed = (seed * 31 + hash.charCodeAt(i)) >>> 0;
  return seed;
}

export function ForensicWatermark({ watermarkText, userIdHash, tileCount = 6 }: ForensicWatermarkProps) {
  const tiles = useMemo(() => {
    const seed = seedFrom(userIdHash || 'reader');
    return Array.from({ length: Math.max(1, Math.min(tileCount, 12)) }, (_, i) => {
      const top = (seed + i * 37) % 90;
      const left = (seed + i * 53) % 80;
      const angle = -20 + ((seed + i * 11) % 9);
      return { top, left, angle, key: i };
    });
  }, [userIdHash, tileCount]);

  if (!watermarkText || !userIdHash) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden select-none">
      {tiles.map((t) => (
        <span
          key={t.key}
          className="absolute whitespace-nowrap text-[11px] font-mono text-slate-400/25"
          style={{ top: `${t.top}%`, left: `${t.left}%`, transform: `rotate(${t.angle}deg)` }}
        >
          {watermarkText} [{userIdHash}]
        </span>
      ))}
    </div>
  );
}

export default ForensicWatermark;
