// SSOT Phase 105 Task 7 — Verify client island (5-state, retry, PDF busy)
// Canonical: apps/frontend/app/(public)/verify/cert/[certificateNo]/verify-client.tsx
'use client';

import React from 'react';
import type { CertificateVerificationPayload } from '@repo/shared';
import { useCertificateVerification } from '../../../../../hooks/useCertificateVerification';
import { CertificateVerifyView } from '../../../../../components/certificate/CertificateVerifyView';

export function VerifyClient({
  certificateNo,
  hash,
  initial,
}: {
  certificateNo: string;
  hash?: string;
  initial: CertificateVerificationPayload | null;
}) {
  const { status, payload, error, busy, retry } = useCertificateVerification(certificateNo, hash, initial);

  if (status === 'LIFF_INIT') {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 sm:p-8 space-y-4 animate-pulse" aria-busy="true">
        <div className="h-6 w-2/3 bg-slate-800 rounded" />
        <div className="h-40 bg-slate-800 rounded-xl" />
        <div className="h-4 w-1/2 bg-slate-800 rounded" />
      </div>
    );
  }

  if (status === 'ERROR' && !payload) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-950/40 p-8 text-center">
        <p className="text-rose-300 text-sm">{error ?? 'ตรวจสอบใบรับรองไม่สำเร็จ'}</p>
        <button type="button" onClick={retry} className="mt-3 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">
          ลองใหม่
        </button>
      </div>
    );
  }

  return <CertificateVerifyView payload={payload} certificateNo={certificateNo} pdfBusy={busy} />;
}
