// SSOT Phase 042 — VideoWatermarkOverlay (HLS player forensic layer)
// Canonical: apps/frontend/components/player/VideoWatermarkOverlay.tsx
// (legacy src/frontend/components/player/VideoWatermarkOverlay.tsx)
// - Reuses the reader ForegroundWatermarkOverlay engine over the HLS viewport
//   with pixel-stego disabled (video frames are re-encoded downstream, so the
//   manifest would not survive — the visible drifting identity is the
//   enforcement layer here; ADR-042).
// - Zero new deps.
'use client';

import { ForegroundWatermarkOverlay } from '../reader/ForegroundWatermarkOverlay';
import type { WatermarkSeedPayload } from '@repo/shared';

interface VideoWatermarkOverlayProps {
  seed: WatermarkSeedPayload;
  width: number;
  height: number;
}

export function VideoWatermarkOverlay({ seed, width, height }: VideoWatermarkOverlayProps) {
  return <ForegroundWatermarkOverlay seed={seed} width={width} height={height} steganography={false} label="STREAM-CONFIDENTIAL" />;
}

export default VideoWatermarkOverlay;
