// SSOT Phase 105 Task 6 — Public certificate verify page (no auth, QR entry)
// Canonical: apps/frontend/app/(public)/verify/cert/[certificateNo]/page.tsx
// - Server fetch (no-store) for instant verified paint + metadata cards.
// - Client VerifyClient handles retry/skeleton (5-state) without refetch flash.
import React from 'react';
import type { Metadata } from 'next';
import type { CertificateVerificationPayload } from '@repo/shared';
import { VerifyClient } from './verify-client';

interface PageProps {
  params: Promise<{ certificateNo: string }>;
  searchParams: Promise<{ hash?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { certificateNo } = await params;
  return {
    title: `ตรวจสอบใบรับรองเลขที่ ${certificateNo} | Official Certificate Verification`,
    description: `ระบบตรวจสอบความถูกต้องของใบรับรองอิเล็กทรอนิกส์สำหรับเลขที่ ${certificateNo}`,
    openGraph: {
      title: `Official Certificate Verification - ${certificateNo}`,
      description: 'ระบบยืนยันความถูกต้องของใบรับรองการจบหลักสูตรด้วยระบบดิจิทัล',
      type: 'website',
    },
  };
}

async function fetchVerifySSR(certificateNo: string, hash?: string): Promise<CertificateVerificationPayload | null> {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const q = hash ? `?hash=${encodeURIComponent(hash)}` : '';
  try {
    const res = await fetch(
      `${backend}/v1/public/certificates/verify/${encodeURIComponent(certificateNo)}${q}`,
      { cache: 'no-store' },
    );
    return (await res.json().catch(() => null)) as CertificateVerificationPayload | null;
  } catch {
    return null;
  }
}

export default async function CertificateVerifyPage({ params, searchParams }: PageProps) {
  const { certificateNo } = await params;
  const { hash } = await searchParams;
  const initial = await fetchVerifySSR(certificateNo, hash);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-3xl mx-auto">
        <VerifyClient certificateNo={certificateNo} hash={hash} initial={initial} />
      </div>
    </main>
  );
}
