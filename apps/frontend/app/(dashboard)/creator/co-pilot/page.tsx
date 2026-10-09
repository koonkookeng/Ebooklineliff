// SSOT Phase 094 Task 5 — Creator Co-Pilot dashboard page
// Canonical: apps/frontend/app/(dashboard)/creator/co-pilot/page.tsx
'use client';

import React, { Suspense } from 'react';
import { OutlineStudio } from '../../../../components/co-pilot/OutlineStudio';

function CoPilotInner() {
  return (
    <div>
      <h1>AI Creator Co-Pilot</h1>
      <OutlineStudio />
    </div>
  );
}

export default function CreatorCoPilotPage() {
  return (
    <Suspense fallback={<p>กำลังโหลด Co-Pilot Studio…</p>}>
      <CoPilotInner />
    </Suspense>
  );
}
