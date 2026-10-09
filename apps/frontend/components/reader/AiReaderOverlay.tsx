// SSOT Phase 092 Task 5 — Reader overlay (floating AI entry on Canvas Reader)
// Canonical: apps/frontend/components/reader/AiReaderOverlay.tsx
// - Mounts the dep-free companion drawer beside the reader; never touches
//   the sliding-window RAM discipline (Gate 5). Zero-dep (React only).
'use client';

import React from 'react';
import { AiCompanionDrawer } from '../ai/AiCompanionDrawer';

export function AiReaderOverlay(props: { productId: string; currentPage: number; bookTitle: string }) {
  return (
    <div aria-label="AI reader overlay">
      <AiCompanionDrawer productId={props.productId} currentPage={props.currentPage} title={props.bookTitle} />
    </div>
  );
}

export default AiReaderOverlay;
