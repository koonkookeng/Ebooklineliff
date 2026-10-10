// SSOT Phase 112 §6/LIFF — creator appeal sheet page (5-state, offline-first)
// Canonical: apps/frontend/app/(liff)/creator/appeals/page.tsx
// - LIFF_INIT (splash) -> IDLE (shield + form) -> LOADING (submit) ->
//   SUCCESS (APPEAL_PENDING toast) / ERROR (alert + retry). Draft autosaves
//   to IndexedDB (§2.1). Zero new deps.
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppealSheet } from '@/components/moderation/AppealSheet';
import { moderationApi, type ModerationStatusView, type ModerationUiState } from '@/lib/moderation/moderation-client';

function CreatorAppealsInner() {
  const params = useSearchParams();
  const tenant = params.get('tenant') ?? 'default';
  const productId = params.get('productId') ?? '';
  const productTitle = params.get('title') ?? productId;
  const [state, setState] = useState<ModerationUiState>('LIFF_INIT');
  const [current, setCurrent] = useState<ModerationStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!productId) {
      setError('ไม่พบ productId');
      setState('ERROR');
      return;
    }
    try {
      const live = await moderationApi(tenant).status(productId);
      setCurrent(live);
      setState('IDLE');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดสถานะไม่สำเร็จ');
      setState('ERROR');
    }
  }, [tenant, productId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(body: { productId: string; appealReason: string; proofDocumentUrls: string[] }): Promise<void> {
    setBusy(true);
    setState('LOADING');
    setError(null);
    try {
      await moderationApi(tenant).submitAppeal(body);
      setState('SUCCESS');
      await load();
      setState('IDLE');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ส่งอุทธรณ์ไม่สำเร็จ');
      setState('ERROR');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'LIFF_INIT') return <p>กำลังโหลดศูนย์อุทธรณ์…</p>;
  if (state === 'SUCCESS') return <p role="status">รับเรื่องอุทธรณ์แล้ว — แอดมินจะพิจารณาภายใน 24 ชม.</p>;

  return (
    <div>
      <h1>อุทธรณ์เนื้อหา</h1>
      {state === 'ERROR' && !current && (
        <p role="alert">
          {error ?? 'เกิดข้อผิดพลาด'}{' '}
          <button type="button" onClick={() => void load()}>
            ลองใหม่
          </button>
        </p>
      )}
      {state === 'LOADING' && !current && <p>กำลังโหลด…</p>}
      {(current || state === 'IDLE') && (
        <AppealSheet productId={productId} productTitle={productTitle} current={current} busy={busy} error={error} onSubmit={submit} />
      )}
    </div>
  );
}

export default function LiffCreatorAppealsPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดศูนย์อุทธรณ์…</p>}>
      <CreatorAppealsInner />
    </Suspense>
  );
}
