// SSOT Phase 085 Task 6 — Creator e-KYC page (LIFF, 5-state)
// Canonical: apps/frontend/app/(liff)/creator/kyc/page.tsx
'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useKycWizard } from '../../../../hooks/useKycWizard';
import { KycWizard } from '../../../../components/kyc/KycWizard';

function CreatorKycInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const tenantName = params.get('tenantName') ?? slug;
  const userId = params.get('uid') ?? 'me';
  const { status, step, setStep, error, current, result, busy, uploadDocument, submit, retry } = useKycWizard(
    slug,
    tenantName,
    userId,
  );

  if (status === 'LIFF_INIT') return <p>กำลังโหลดศูนย์ยืนยันตัวตน…</p>;
  if (status === 'LOADING') return <p>กำลังตรวจ OCR และส่งแบบฟอร์ม…</p>;

  if (status === 'SUCCESS' && result) {
    return (
      <div>
        <p role="status">ส่ง e-KYC สำเร็จ — คะแนนชื่อ {result.nameMatchScore} (tier {result.tier})</p>
        <p>สถานะ: รอแอดมินอนุมัติภายใน 24 ชม.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>ยืนยันตัวตน Creator</h1>
      {current && <p>สถานะปัจจุบัน: {current.kycStatus}{current.payoutStatus ? ` · บัญชีรับเงิน ${current.payoutStatus}` : ''}</p>}
      {current?.rejectionReason && <p role="alert">ถูกปฏิเสธ: {current.rejectionReason} — แก้ไขแล้วส่งใหม่ได้</p>}
      <KycWizard step={step} setStep={setStep} busy={busy} error={error} onFile={uploadDocument} onSubmit={submit} />
      {status === 'ERROR' && (
        <button type="button" onClick={retry}>
          ลองใหม่
        </button>
      )}
    </div>
  );
}

export default function LiffCreatorKycPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดศูนย์ยืนยันตัวตน…</p>}>
      <CreatorKycInner />
    </Suspense>
  );
}
