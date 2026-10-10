// SSOT Phase 112 §6.2 — admin moderation studio page (5-state, dep-free)
// Canonical: apps/frontend/app/(admin)/moderation/page.tsx
// - MOD_INIT (skeleton) -> IDLE (queue) -> LOADING (review overlay) ->
//   SUCCESS (toast) / ERROR (banner + retry). Zero new deps.
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ModerationQueue } from '@/components/moderation/ModerationQueue';
import { moderationApi, type ModerationQueueView } from '@/lib/moderation/moderation-client';

type StudioState = 'MOD_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

function ModerationStudioInner() {
  const params = useSearchParams();
  const tenant = params.get('tenant') ?? 'default';
  const [state, setState] = useState<StudioState>('MOD_INIT');
  const [queue, setQueue] = useState<ModerationQueueView>({ items: [], totalCount: 0, quarantinedCount: 0, appealPendingCount: 0 });
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState((s) => (s === 'MOD_INIT' ? s : 'LOADING'));
    setError(null);
    try {
      const data = await moderationApi(tenant).queue({ status: statusFilter || undefined, page: 1, limit: 20 });
      setQueue(data);
      setState('IDLE');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดคิวไม่สำเร็จ');
      setState('ERROR');
    }
  }, [tenant, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(productId: string, approve: boolean, adminNotes: string): Promise<void> {
    setBusy(true);
    setState('LOADING');
    try {
      await moderationApi(tenant).review({ productId, approve, adminNotes });
      setState('SUCCESS');
      await load();
      setState('IDLE');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
      setState('ERROR');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'MOD_INIT') return <p>กำลังโหลดศูนย์ตรวจสอบเนื้อหา…</p>;

  return (
    <div>
      <h1>AI Content Moderation Control Center</h1>
      <p role="status">
        ทั้งหมด {queue.totalCount} · กักกัน {queue.quarantinedCount} · รออุทธรณ์ {queue.appealPendingCount}
      </p>
      <label>
        กรองสถานะ
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">QUARANTINED + FLAGGED + APPEAL_PENDING</option>
          <option value="QUARANTINED">QUARANTINED</option>
          <option value="FLAGGED_NSFW">FLAGGED_NSFW</option>
          <option value="FLAGGED_COPYRIGHT">FLAGGED_COPYRIGHT</option>
          <option value="FLAGGED_PROFANITY">FLAGGED_PROFANITY</option>
          <option value="APPEAL_PENDING">APPEAL_PENDING</option>
          <option value="PASSED">PASSED</option>
        </select>
      </label>
      {state === 'ERROR' && (
        <p role="alert">
          {error ?? 'เกิดข้อผิดพลาด'}{' '}
          <button type="button" onClick={() => void load()}>
            ลองใหม่
          </button>
        </p>
      )}
      {state === 'LOADING' && <p>กำลังโหลด…</p>}
      <ModerationQueue items={queue.items} busy={busy} onReview={review} />
    </div>
  );
}

export default function AdminModerationStudioPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดศูนย์ตรวจสอบเนื้อหา…</p>}>
      <ModerationStudioInner />
    </Suspense>
  );
}
