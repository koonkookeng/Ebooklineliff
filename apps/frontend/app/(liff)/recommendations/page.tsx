// SSOT Phase 104 Task 7 — Recommendations page (LIFF & Web)
// Canonical: apps/frontend/app/(liff)/recommendations/page.tsx
'use client';

import React, { Suspense } from 'react';
import { AIRecommendedSlate } from '../../../components/recommendation/AIRecommendedSlate';

export default function LiffRecommendationsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" /></div>}>
      <AIRecommendedSlate />
    </Suspense>
  );
}
