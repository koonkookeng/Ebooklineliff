// SSOT Phase 025 §6.2 — Client-side dynamic resolver page (5-state machine)
// Canonical: apps/frontend/app/(liff)/resolve/page.tsx
// (legacy src/frontend/app/(liff)/resolve/page.tsx)
// States: LIFF_INIT (branded splash) → IDLE (params parsed) → LOADING
// (resolve fetch) → SUCCESS (router.replace target) / ERROR (fallback dialog:
// "เปิดในเบราว์เซอร์" | "กลับหน้าหลัก"). Corrupt liff.state → /store (Gate 9,
// never a 500). RAM guard: LIFF SDK lazy via lib/liff/liff-sdk (no static import).
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { initLiff } from '../../../lib/liff/liff-sdk';
import { parseLiffStateToPath, type ResolveShortCodeResponse } from '@repo/shared';
import { persistAffiliateAttribution, resolveShortCode } from '../../../lib/resolver';

type ResolverStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

const MESSAGES: Record<ResolverStatus, string> = {
  LIFF_INIT: 'กำลังเชื่อมต่อระบบมินิแอป...',
  IDLE: 'กำลังเตรียมเส้นทาง...',
  LOADING: 'กำลังถอดรหัสเส้นทาง...',
  SUCCESS: 'เปิดหน้าเนื้อหา...',
  ERROR: 'ไม่สามารถเปิดลิงก์ได้',
};

function liffIdFor(tenant: string): string {
  if (typeof window !== 'undefined') {
    const meta = document.querySelector('meta[name="liff-id"]')?.getAttribute('content');
    if (meta) return meta;
  }
  // Mirror (liff)/layout tenant override convention (no new deps).
  const envKey = `NEXT_PUBLIC_LIFF_ID_${tenant.toUpperCase()}`;
  return process.env[envKey] ?? process.env.NEXT_PUBLIC_LINE_LIFF_ID ?? 'default-liff-id';
}

export default function LiffResolvePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<ResolverStatus>('LIFF_INIT');
  const [message, setMessage] = useState<string>(MESSAGES.LIFF_INIT);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const executeResolution = async (): Promise<void> => {
      try {
        const code = searchParams.get('code');
        const liffState = searchParams.get('liff.state') ?? searchParams.get('liff_state');

        // LIFF handshake (best-effort: external PWA still resolves via code).
        // initLiff is idempotent per liffId (lib/liff/liff-sdk singleton).
        try {
          await initLiff(liffIdFor(searchParams.get('tenant') ?? 'default'));
        } catch {
          // External browser / SDK unavailable → continue with code resolution.
        }
        if (cancelled) return;
        setStatus('IDLE');
        setMessage(MESSAGES.IDLE);

        let targetPath = '/store';
        if (code) {
          setStatus('LOADING');
          setMessage(MESSAGES.LOADING);
          const data: ResolveShortCodeResponse = await resolveShortCode(code, controller.signal);
          persistAffiliateAttribution(data.affiliateCode);
          targetPath = data.customPath || data.targetUrl;
        } else if (liffState) {
          targetPath = parseLiffStateToPath(liffState);
          const aff = new URLSearchParams(targetPath.split('?')[1] ?? '').get('aff');
          persistAffiliateAttribution(aff);
        }

        if (cancelled) return;
        setStatus('SUCCESS');
        setMessage(MESSAGES.SUCCESS);
        router.replace(targetPath);
      } catch {
        if (cancelled) return;
        setStatus('ERROR');
        setMessage('ไม่สามารถเปิดลิงก์ได้ กำลังนำท่านไปยังหน้าหลัก...');
        window.setTimeout(() => {
          if (!cancelled) router.replace('/store');
        }, 1500);
      }
    };

    void executeResolution();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [searchParams, router]);

  if (status === 'ERROR') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 text-white">
        <p className="mb-1 text-base font-semibold">ไม่สามารถเปิดลิงก์ได้</p>
        <p className="mb-6 text-sm text-slate-400">{message}</p>
        <div className="flex gap-3">
          <button
            type="button"
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm"
            onClick={() => {
              const raw = window.location.href;
              window.open(raw, '_blank', 'noopener');
            }}
          >
            เปิดในเบราว์เซอร์
          </button>
          <button
            type="button"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium"
            onClick={() => router.replace('/store')}
          >
            กลับหน้าหลัก
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 text-white">
      <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
      <p className="animate-pulse text-sm font-medium text-slate-300">{message}</p>
    </div>
  );
}
