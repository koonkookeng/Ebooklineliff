// SSOT Phase 026 Task 6 — Viral share preview page (BDD Scenario 2 entry)
// Canonical: apps/frontend/app/(liff)/share/preview/page.tsx
// (legacy src/frontend/app/(liff)/share/...)
// Flow: ?st= token → preview proxy (click tracked, K-factor event) → product
// teaser + "อ่านตัวอย่างฟรี (10 หน้าแรก)" CTA + 30-day referral bind note.
// ?ref= affiliate code persisted to localStorage (Phase 025 seam) so checkout
// attributes commission to the sharer. Unknown token → /store (never 500).
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { persistAffiliateAttribution } from '../../../../lib/resolver';
import { SHARE_PREVIEW_MAX_PAGE } from '@repo/shared';

type PreviewStatus = 'LIFF_INIT' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface PreviewData {
  shareLogId: string;
  productId: string;
  productTitle: string;
  productType: string;
  coverImageUrl: string;
}

export default function SharePreviewPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<PreviewStatus>('LIFF_INIT');
  const [preview, setPreview] = useState<PreviewData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const st = searchParams.get('st');
      const ref = searchParams.get('ref');
      if (ref) persistAffiliateAttribution(ref);
      if (!st) {
        router.replace('/store');
        return;
      }
      setStatus('LOADING');
      try {
        const res = await fetch(`/api/v1/social-share/preview?st=${encodeURIComponent(st)}`);
        if (!res.ok) throw new Error('preview unavailable');
        const data = (await res.json()) as PreviewData | null;
        if (cancelled || !data?.productId) {
          router.replace('/store');
          return;
        }
        setPreview(data);
        setStatus('SUCCESS');
      } catch {
        if (!cancelled) setStatus('ERROR');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [searchParams, router]);

  if (status === 'LIFF_INIT' || status === 'LOADING') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 text-white">
        <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        <p className="animate-pulse text-sm font-medium text-slate-300">กำลังเปิดตัวอย่างที่เพื่อนแชร์มา...</p>
      </div>
    );
  }

  if (status === 'ERROR' || !preview) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center text-white">
        <p className="text-base font-semibold">เปิดตัวอย่างไม่ได้</p>
        <p className="text-sm text-slate-400">ลิงก์อาจหมดอายุ ลองขอให้เพื่อนส่งใหม่นะ</p>
        <button
          type="button"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium"
          onClick={() => router.replace('/store')}
        >
          กลับหน้าหลัก
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-950 p-6 text-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview.coverImageUrl} alt={preview.productTitle} className="mb-4 max-h-64 rounded-xl object-contain" />
      <p className="mb-1 text-xs text-emerald-400">เพื่อนแชร์มาให้ลอง</p>
      <h1 className="mb-4 text-center text-lg font-bold">{preview.productTitle}</h1>
      <button
        type="button"
        className="mb-2 w-full max-w-xs rounded-xl bg-[var(--tenant-primary,#059669)] py-3 font-semibold"
        onClick={() => router.replace(`/pdp/${preview.productId}?preview=1&ref=${encodeURIComponent(searchParams.get('ref') ?? '')}`)}
      >
        อ่านตัวอย่างฟรี ({SHARE_PREVIEW_MAX_PAGE} หน้าแรก)
      </button>
      <p className="text-xs text-slate-500">ซื้อผ่านลิงก์นี้ เพื่อนผู้แชร์ได้รับคะแนนสะสม</p>
    </div>
  );
}
