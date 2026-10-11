// SSOT Phase 003 §2.2 — LIFF profile home (address book entry, 5-state)
// Canonical: apps/frontend/app/(liff)/profile/page.tsx
// (legacy src/frontend/app/(liff)/profile/*)
// - Hosts the AddressBookManager (BUSINESS_GOAL multi-address book).
//   Text-first, <30MB. Zero new deps.
'use client';

import React, { Suspense } from 'react';
import { AddressBookManager } from '@/components/identity/AddressBookManager';

export default function ProfilePage() {
  return (
    <Suspense fallback={<main style={{ padding: 24 }}><p>กำลังโหลดโปรไฟล์…</p></main>}>
      <main style={{ padding: 24 }}>
        <h1>โปรไฟล์ของฉัน</h1>
        <p><a href="/profile/kyc">ยืนยันตัวตน e-KYC</a></p>
        <h2>สมุดที่อยู่จัดส่ง</h2>
        <AddressBookManager />
      </main>
    </Suspense>
  );
}
