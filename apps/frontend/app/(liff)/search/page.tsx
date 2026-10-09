// SSOT Phase 091 BDD-1 — LIFF semantic search page
// Canonical: apps/frontend/app/(liff)/search/page.tsx
'use client';

import React, { Suspense } from 'react';
import { SemanticSearchInput } from '../../../components/search/SemanticSearchInput';

function SearchInner() {
  return (
    <div>
      <h1>ค้นหาเชิงความหมาย</h1>
      <SemanticSearchInput />
    </div>
  );
}

export default function LiffSearchPage() {
  return (
    <Suspense fallback={<p>กำลังเตรียมระบบค้นหา…</p>}>
      <SearchInner />
    </Suspense>
  );
}
