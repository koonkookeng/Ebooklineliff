// SSOT Phase 026 Task 5 — Canvas reader share overlay (mounts NativeActionButton)
// Canonical: apps/frontend/components/reader/CanvasReaderOverlay.tsx
// (legacy src/frontend/components/reader/CanvasReaderOverlay.tsx)
// - Zero-touch to the reader engine (§9): standalone overlay bar; host pages
//   mount it with productId + currentPage. No canvas/RAM impact when hidden.
'use client';

import React from 'react';
import { NativeActionButton } from '../share/NativeActionButton';

interface CanvasReaderOverlayProps {
  productId: string;
  currentPage?: number;
  visible?: boolean;
}

export function CanvasReaderOverlay({ productId, currentPage, visible = true }: CanvasReaderOverlayProps) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-end p-4">
      <div className="pointer-events-auto">
        <NativeActionButton productId={productId} contentType="EBOOK_PAGE" currentPage={currentPage} variant="floating" />
      </div>
    </div>
  );
}

export default CanvasReaderOverlay;
