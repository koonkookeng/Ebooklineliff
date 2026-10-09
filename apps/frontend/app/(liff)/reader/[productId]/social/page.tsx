// SSOT Phase 095 — LIFF social reading page (overlay + drawer host)
// Canonical: apps/frontend/app/(liff)/reader/[productId]/social/page.tsx
'use client';

import React, { Suspense, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useSocialNotes } from '../../../../../hooks/useSocialNotes';
import { SocialReadingOverlay } from '../../../../../components/reader/SocialReadingOverlay';
import { MarginNoteDrawer } from '../../../../../components/reader/MarginNoteDrawer';

function SocialInner() {
  const params = useParams<{ productId: string }>();
  const search = useSearchParams();
  const ebookId = search.get('ebookId') ?? params.productId;
  const pageNumber = Number(search.get('page')) || 1;
  const { status, error, notes, reload } = useSocialNotes(ebookId, pageNumber);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div>
      <h1>Social Reading หน้า {pageNumber}</h1>
      {(status === 'LIFF_INIT' || status === 'LOADING') && <p aria-busy="true">กำลังโหลดโน้ตเพื่อนนักอ่าน…</p>}
      {status === 'ERROR' && error && <p role="alert">{error}</p>}
      <SocialReadingOverlay notes={notes} loading={status === 'LOADING'} onSelect={setSelectedId} />
      <MarginNoteDrawer ebookId={ebookId} pageNumber={pageNumber} notes={notes} selectedId={selectedId} onCreated={reload} />
    </div>
  );
}

export default function LiffSocialReadingPage() {
  return (
    <Suspense fallback={<p>กำลังเตรียมโหมด Social Reading…</p>}>
      <SocialInner />
    </Suspense>
  );
}
