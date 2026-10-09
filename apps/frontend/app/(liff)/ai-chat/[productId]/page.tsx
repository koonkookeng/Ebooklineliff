// SSOT Phase 092 — LIFF AI chat page (drawer host)
// Canonical: apps/frontend/app/(liff)/ai-chat/[productId]/page.tsx
'use client';

import React, { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { AiCompanionDrawer } from '../../../../components/ai/AiCompanionDrawer';

function AiChatInner() {
  const params = useParams<{ productId: string }>();
  const search = useSearchParams();
  const page = Number(search.get('page')) || undefined;
  return (
    <div>
      <h1>AI ผู้ช่วยเรียนรู้</h1>
      <AiCompanionDrawer productId={params.productId} currentPage={page} title="AI Chat" />
    </div>
  );
}

export default function LiffAiChatPage() {
  return (
    <Suspense fallback={<p>กำลังเตรียม AI ผู้ช่วย…</p>}>
      <AiChatInner />
    </Suspense>
  );
}
