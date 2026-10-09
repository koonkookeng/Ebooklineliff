// SSOT Phase 095 Task 5 — Social reading overlay (pin layer, DOM-light)
// Canonical: apps/frontend/components/reader/SocialReadingOverlay.tsx
// - Renders margin pins as positioned buttons (≤100/page, Gate 5); the
//   canvas page itself stays owned by the reader engine (adapter pattern,
//   §9 — no canvas duplication). Zero-dep (React only).
'use client';

import React from 'react';
import type { PageNote } from '../../lib/social/social-client';

export function SocialReadingOverlay(props: {
  notes: PageNote[];
  loading: boolean;
  onSelect: (noteId: string) => void;
}) {
  const { notes, loading, onSelect } = props;
  return (
    <div aria-label="Social reading pins">
      {loading && <p aria-busy="true">กำลังโหลดโน้ตเพื่อนนักอ่าน…</p>}
      {notes.slice(0, 100).map((n) => (
        <button
          key={n.id}
          type="button"
          onClick={() => onSelect(n.id)}
          title={`${n.userDisplayName}: ${n.content.slice(0, 80)}`}
          aria-label={`โน้ตของ ${n.userDisplayName}${n.isAuthorNote ? ' (ผู้เขียน)' : ''}`}
          style={{ left: `${n.positionX}%`, top: `${n.positionY}%` }}
        >
          📌{n.isAuthorNote ? '✦' : ''}
        </button>
      ))}
    </div>
  );
}

export default SocialReadingOverlay;
