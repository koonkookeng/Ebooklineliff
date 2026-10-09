// SSOT Phase 086 Task 7 — Admin finance clearing dashboard
// Canonical: apps/frontend/app/(dashboard)/admin/finance/clearing/page.tsx
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClearingBoard } from '../../../../../components/payout/ClearingBoard';
import { payoutApi, type ClearingQueueItem } from '../../../../../lib/payout/payout-client';

function ClearingInner() {
  const params = useSearchParams();
  const slug = params.get('tenant') ?? 'default';
  const [rows, setRows] = useState<ClearingQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await payoutApi(slug).queue());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p role="alert">{error}</p>;
  if (!rows) return <p>กำลังโหลดคิวเคลียร์…</p>;

  return (
    <div>
      <h1>เคลียร์ยอดโอนธนาคาร</h1>
      <ClearingBoard slug={slug} initial={rows} />
    </div>
  );
}

export default function AdminClearingPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดคิวเคลียร์…</p>}>
      <ClearingInner />
    </Suspense>
  );
}
