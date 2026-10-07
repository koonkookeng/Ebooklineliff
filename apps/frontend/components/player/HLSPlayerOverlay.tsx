// SSOT Phase 026 Task 5 — HLS player share overlay (mounts NativeActionButton)
// Canonical: apps/frontend/components/player/HLSPlayerOverlay.tsx
// (legacy src/frontend/components/player/HLSPlayerOverlay.tsx)
// - Zero-touch to the HLS engine (§9): standalone overlay; host players mount
//   it with productId + lessonId. Hidden until playback starts (no RAM cost).
'use client';

import React from 'react';
import { NativeActionButton } from '../share/NativeActionButton';

interface HLSPlayerOverlayProps {
  productId: string;
  lessonId?: string;
  visible?: boolean;
}

export function HLSPlayerOverlay({ productId, lessonId, visible = true }: HLSPlayerOverlayProps) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-end p-3">
      <div className="pointer-events-auto">
        <NativeActionButton productId={productId} contentType="COURSE_LESSON" lessonId={lessonId} variant="inline" />
      </div>
    </div>
  );
}

export default HLSPlayerOverlay;
