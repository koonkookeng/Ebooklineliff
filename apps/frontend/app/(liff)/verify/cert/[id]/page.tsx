// SSOT Phase 048 Task 5 — Public Verification Portal Page (LIFF & Web)
// Canonical: apps/frontend/app/(liff)/verify/cert/[id]/page.tsx
// (legacy src/frontend/app/(liff)/verify/cert/[id]/page.tsx)
// - 5-state machine: LIFF_INIT → LOADING → SUCCESS (verified) / ERROR (invalid/revoked).
// - Public access (no auth); rate-limited by backend (20 req/min).
// - Tenant accent/logo via query params.
// - Zero new deps (inline SVG glyphs; lucide-react is NOT a dependency).
'use client';

import { Suspense, use, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';

function AwardGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="8" r="6" />
      <path d="M15.5 13 17 22l-5-3-5 3 1.5-9" />
    </svg>
  );
}

function CrossGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

interface VerifyPageProps {
  params: Promise<{ id: string }>;
}

interface CertData {
  isValid: boolean;
  certificateNo: string;
  studentName: string;
  courseTitle: string;
  issuedAt: string;
  issuerName: string;
  digitalSignatureHash: string;
  pdfUrl: string;
}

type VerifyState = 'LIFF_INIT' | 'LOADING' | 'SUCCESS' | 'ERROR';

function CertificateVerifyInner({ params }: VerifyPageProps) {
  const { id } = use(params);
  const params_search = useSearchParams();
  const accent = params_search.get('color') ?? '#059669';
  const [state, setState] = useState<VerifyState>('LIFF_INIT');
  const [data, setData] = useState<CertData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState('LOADING');
    setError(null);

    fetchCertData(id)
      .then((data) => {
        if (cancelled) return;
        if (data?.isValid) {
          setData(data);
          setState('SUCCESS');
        } else {
          setError('Certificate not found or invalid');
          setState('ERROR');
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Verification failed');
        setState('ERROR');
      });

    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  if (state === 'LIFF_INIT' || state === 'LOADING') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white" aria-busy style={{ borderTop: `3px solid ${accent}` }}>
        <div className="flex flex-col items-center gap-4">
          <AwardGlyph className="h-16 w-12 text-emerald-400 animate-pulse" />
          <p className="text-sm font-medium">กำลังตรวจสอบความถูกต้องของวุฒิบัตร...</p>
        </div>
      </div>
    );
  }

  if (state === 'ERROR' || !data) {
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 p-4 text-white">
        <div className="flex flex-col items-center gap-3 w-full max-w-md rounded-2xl bg-slate-900 p-8 text-center border border-red-500/30">
          <CrossGlyph className="mx-auto h-16 w-16 text-red-500" />
          <h1 className="text-xl font-bold text-red-400">วุฒิบัตรไม่ถูกต้อง หรือถูกยกเลิก</h1>
          <p className="text-xs text-slate-400 text-center max-w-xs">
            {error || 'ไม่พบรหัสวุฒิบัตรนี้ในระบบ หรือเอกสารอาจถูกดัดแปลง'}
          </p>
          <button onClick={() => setAttempt((a) => a + 1)} className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500">
            ลองอีกครั้ง
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 text-white flex flex-col items-center justify-center" style={{ '--cert-primary': accent } as CSSProperties}>
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 p-6 border border-emerald-500/30 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
          <div className="h-10 w-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <AwardGlyph className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-emerald-400">Verified Official Credential</h1>
            <p className="text-xs text-slate-400">ตรวจสอบพบวุฒิบัตรฉบับจริงในระบบ</p>
          </div>
        </div>

        <div className="mt-6 space-y-4 text-sm">
          <div>
            <span className="text-xs text-slate-500 uppercase">ชื่อผู้ได้รับวุฒิบัตร</span>
            <p className="text-base font-semibold text-white">{data.studentName}</p>
          </div>
          <div>
            <span className="text-xs text-slate-500 uppercase">หลักสูตรที่สำเร็จการศึกษา</span>
            <p className="text-base font-semibold text-emerald-300">{data.courseTitle}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-xs text-slate-500 uppercase">รหัสวุฒิบัตร</span>
              <p className="font-mono text-xs text-slate-300">{data.certificateNo}</p>
            </div>
            <div>
              <span className="text-xs text-slate-500 uppercase">วันที่ออกเอกสาร</span>
              <p className="text-xs text-slate-300">{new Date(data.issuedAt).toLocaleDateString('th-TH')}</p>
            </div>
          </div>
          <div className="rounded-lg bg-slate-950 p-3 text-[10px] font-mono text-slate-500 break-all border border-slate-800">
            HMAC Sig: {data.digitalSignatureHash}
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <a href={data.pdfUrl} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white text-center hover:bg-emerald-500">
            ดาวน์โหลด PDF
          </a>
          <button className="flex-1 rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/5">
            แชร์
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CertificateVerifyPage({ params }: VerifyPageProps) {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-950 text-white" aria-busy><div className="h-8 w-8 animate-spin rounded-full border-t-2 border-emerald-500" /></div>}>
      <CertificateVerifyInner params={params} />
    </Suspense>
  );
}

async function fetchCertData(id: string): Promise<CertData | null> {
  try {
    const res = await fetch(`/api/certificate/verify?certNo=${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.isValid) return null;
    return data;
  } catch {
    return null;
  }
}