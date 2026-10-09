// SSOT Phase 092 Task 5 — Video overlay (floating AI entry on HLS player)
// Canonical: apps/frontend/components/video/AiVideoOverlay.tsx
// - Mounts the dep-free companion drawer beside the player with the lesson
//   timestamp as context; player pause is handled by the host page.
//   Zero-dep (React only).
'use client';

import React from 'react';
import { AiCompanionDrawer } from '../ai/AiCompanionDrawer';

export function AiVideoOverlay(props: { productId: string; lessonId: string; currentSec: number; lessonTitle: string }) {
  return (
    <div aria-label="AI video overlay">
      <AiCompanionDrawer
        productId={props.productId}
        currentLessonSec={props.currentSec}
        title={`${props.lessonTitle} (${props.currentSec}วิ)`}
      />
    </div>
  );
}

export default AiVideoOverlay;
