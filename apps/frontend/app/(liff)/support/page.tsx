// SSOT Phase 103 Task 6 — Support page (LIFF & Web)
// Canonical: apps/frontend/app/(liff)/support/page.tsx
'use client';

import React, { Suspense } from 'react';
import { SupportChat } from '../../../components/support/SupportChat';

export default function LiffSupportPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" /></div>}>
      <SupportChat />
    </Suspense>
  );
}