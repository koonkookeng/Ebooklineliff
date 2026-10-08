// SSOT Phase 080 BDD-2 — Signed click-attribution entry (5-state)
// Canonical: apps/frontend/app/(liff)/share/page.tsx
// Flow: ?refToken= -> track-click proxy (HMAC verified server-side) ->
// persist affiliateCode locally (025 seam) -> PDP with the token.
// Missing/invalid token -> /store (never 500). ?ref= codes pass through.
'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { persistAffiliateAttribution } from '../../../lib/resolver';

type ShareEntryStatus = 'LIFF_INIT' | 'LOADING' | 'SUCCESS' | 'ERROR';

function ShareEntryInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<ShareEntryStatus>('LIFF_INIT');

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      const ref = params.get('ref');
      if (ref) persistAffiliateAttribution(ref);
      const refToken = params.get('refToken');
      if (!refToken) {
        router.replace('/store');
        return;
      }
      setStatus('LOADING');
      try {
        const res = await fetch('/api/v1/share/track-click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refToken }),
        });
        const data = (await res.json().catch(() => null)) as {
          success?: boolean;
          affiliateCode?: string;
          productId?: string;
        } | null;
        if (data?.affiliateCode) persistAffiliateAttribution(data.affiliateCode);
        if (cancelled) return;
        if (!data?.success || !data?.productId) {
          setStatus('ERROR');
          return;
        }
        setStatus('SUCCESS');
        router.replace(`/pdp/${data.productId}?refToken=${encodeURIComponent(refToken)}`);
      } catch {
        if (!cancelled) setStatus('ERROR');
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [params, router]);

  if (status === 'ERROR') {
    return (
      <div>
        <p role="alert">เปิดลิงก์ที่เพื่อนแชร์มาไม่ได้</p>
        <button type="button" onClick={() => router.replace('/store')}>
          กลับหน้าหลัก
        </button>
      </div>
    );
  }
  return <p>กำลังเปิดสิ่งที่เพื่อนแชร์มา…</p>;
}

export default function LiffShareEntryPage() {
  return (
    <Suspense fallback={<p>กำลังเปิดสิ่งที่เพื่อนแชร์มา…</p>}>
      <ShareEntryInner />
    </Suspense>
  );
}
