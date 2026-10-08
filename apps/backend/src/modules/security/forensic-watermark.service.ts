// SSOT Phase 055 Task 6 — low-overhead forensic watermark layout (scalar math)
// Canonical: apps/backend/src/modules/security/forensic-watermark.service.ts
// (legacy src/backend/modules/security/forensic-watermark.service.ts)
// - Computes deterministic, per-page watermark geometry from the 12-hex
//   userIdHash (§8.1: client-side pixel math, no GPU/CPU burden on
//   budget phones). The Canvas layer only executes the emitted draw spec.
// - Pure + tsx-importable (no Nest param decorators on logic paths).
import { Injectable } from '@nestjs/common';

export interface WatermarkDrawSpec {
  text: string;
  x: number;
  y: number;
  font: string;
  fillStyle: string;
  rotationDeg: number;
}

/** Deterministic 32-bit hash (FNV-1a) over the id material. */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

@Injectable()
export class ForensicWatermarkService {
  /** Per-page position drifts inside a safe margin so captures stay traceable. */
  layout(userIdHash: string, pageNumber: number, width: number, height: number): { x: number; y: number } {
    const seed = fnv1a32(`${userIdHash}:${pageNumber}`);
    const marginX = Math.max(16, Math.floor(width * 0.05));
    const marginY = Math.max(16, Math.floor(height * 0.04));
    const spanX = Math.max(1, width - marginX * 2);
    const spanY = Math.max(1, height - marginY * 2);
    return {
      x: marginX + (seed % spanX),
      y: marginY + (Math.floor(seed / 7919) % spanY),
    };
  }

  /** Full canvas draw spec (single fillText — the cheapest traceable mark). */
  drawSpec(userIdHash: string, pageNumber: number, width: number, height: number, timestamp: string): WatermarkDrawSpec {
    const { x, y } = this.layout(userIdHash, pageNumber, width, height);
    return {
      text: `ID: ${userIdHash} | ${timestamp}`,
      x,
      y,
      font: '14px sans-serif',
      fillStyle: 'rgba(150, 150, 150, 0.25)',
      rotationDeg: -12,
    };
  }
}
