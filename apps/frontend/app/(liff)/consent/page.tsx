// SSOT Phase 129 §2.2/§6.1 — LIFF consent gate page (5 mandatory states)
// Canonical: apps/frontend/app/(liff)/consent/page.tsx
// (legacy src/frontend/app/(liff)/consent/*)
// - LIFF_INIT (splash) -> CONSENT_REQUIRED (strict bottom sheet) /
//   IDLE_COMPLIANT (library entry) / PROCESSING_RIGHTS (lock dialog) /
//   ERROR_NON_COMPLIANT (fallback + re-auth). Text-first, <30MB.
// - Zero new deps.
'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PdpaConsentModal } from '@/components/security/PdpaConsentModal';
import { useLineLiffAuth } from '@/hooks/useLineLiffAuth';

function ConsentInner() {
  const params = useSearchParams();
  const tenant = params.get('tenant') ?? 'default';
  const tenantName = params.get('tenantName') ?? 'E-Book Store';
  const { state, status, error, submitConsent, retry } = useLineLiffAuth(tenant);

  if (state === 'LIFF_INIT' || state === 'PROCESSING_RIGHTS') {
    return (
      <main aria-busy="true" style={{ padding: 24 }}>
        <p>{state === 'LIFF_INIT' ? 'กำลังยืนยันตัวตนกับ LINE…' : 'กำลังบันทึกความยินยอม…'}</p>
      </main>
    );
  }

  if (state === 'ERROR_NON_COMPLIANT') {
    return (
      <main style={{ padding: 24 }}>
        <h1>เข้าใช้งานไม่ได้ชั่วคราว</h1>
        <p>{error ?? 'Token หมดอายุหรือถูกปฏิเสธ กรุณายืนยันตัวตนใหม่'}</p>
        <button type="button" onClick={retry} style={{ minHeight: 44 }}>
          Re-authenticate with LINE
        </button>
      </main>
    );
  }

  if (state === 'CONSENT_REQUIRED') {
    return (
      <main style={{ padding: 24 }}>
        <h1>ขอความยินยอมการใช้ข้อมูล</h1>
        <p>กรุณาอ่านและเลือกความยินยอมก่อนเข้าใช้งาน (version {status?.consentVersion ?? '2026-10-01'})</p>
        <PdpaConsentModal isOpen tenantName={tenantName} onAccept={(purposes) => void submitConsent(purposes)} />
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>ยินดีต้อนรับ</h1>
      <p>ความยินยอมครบถ้วนแล้ว เข้าใช้งานได้ตามสิทธิ์</p>
      <a href="/library">เข้าห้องสมุดของฉัน</a>
    </main>
  );
}

export default function ConsentPage() {
  return (
    <Suspense fallback={<main style={{ padding: 24 }}><p>กำลังโหลด…</p></main>}>
      <ConsentInner />
    </Suspense>
  );
}
