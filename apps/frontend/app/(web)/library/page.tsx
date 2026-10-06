// SSOT Phase 018 §6 — Web My Library route (desktop grid, mirrors LIFF)
// Canonical: apps/frontend/app/(web)/library/page.tsx
'use client';

import React, { Suspense } from 'react';
import { MyLibraryView } from '../../../components/library/MyLibraryView';

export default function WebLibraryPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-4xl px-4 py-6"><div className="h-32 rounded-2xl bg-gray-100 animate-pulse" /></main>}>
      <main className="mx-auto max-w-4xl">
        <MyLibraryView gridClass="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mt-4" />
      </main>
    </Suspense>
  );
}
