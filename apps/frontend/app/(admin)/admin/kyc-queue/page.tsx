// SSOT Phase 111 §6.2 — admin KYC verification queue page (5-state)
// Canonical: apps/frontend/app/(admin)/admin/kyc-queue/page.tsx
// - LIFF_INIT (skeleton) -> IDLE (workspace) -> LOADING (verdict overlay) ->
//   SUCCESS (toast) / ERROR (banner + retry). F8 approve / F9 reject.
// - Data via Next proxies -> backend 111 queue REST (masked PII, 300s URLs).
// - Zero new deps.
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { KycQueueWorkspace, type KycQueueItemView, type QueueWorkspaceState } from '@/components/kyc/KycQueueWorkspace';

interface QueueResponse {
  items: KycQueueItemView[];
  totalCount: number;
  pendingCount: number;
  highRiskCount: number;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`kyc-queue ${res.status}`);
  return (await res.json()) as T;
}

function KycQueueInner() {
  const params = useSearchParams();
  const tenant = params.get('tenant') ?? 'default';
  const [state, setState] = useState<QueueWorkspaceState>('LIFF_INIT');
  const [items, setItems] = useState<KycQueueItemView[]>([]);
  const [counts, setCounts] = useState({ total: 0, pending: 0, highRisk: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [riskFilter, setRiskFilter] = useState('');

  const load = useCallback(async () => {
    setState((s) => (s === 'LIFF_INIT' ? s : 'LOADING'));
    setError(null);
    try {
      const qs = new URLSearchParams({ tenant, page: '1', limit: '20' });
      if (riskFilter) qs.set('riskLevel', riskFilter);
      const data = await getJson<QueueResponse>(`/api/v1/admin/kyc111/queue?${qs.toString()}`);
      setItems(data.items);
      setCounts({ total: data.totalCount, pending: data.pendingCount, highRisk: data.highRiskCount });
      setState('IDLE');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดคิวไม่สำเร็จ');
      setState('ERROR');
    }
  }, [tenant, riskFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function postReview(body: unknown): Promise<void> {
    setBusy(true);
    setState('LOADING');
    try {
      const res = await fetch(`/api/v1/admin/kyc111/review?tenant=${encodeURIComponent(tenant)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`review ${res.status}`);
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

  if (state === 'LIFF_INIT') return <p>กำลังโหลดพื้นที่ตรวจสอบ KYC…</p>;

  return (
    <div>
      <h1>คิวตรวจสอบ KYC</h1>
      <p role="status">
        ทั้งหมด {counts.total} · รออนุมัติ {counts.pending} · เสี่ยงสูง {counts.highRisk}
      </p>
      <label>
        กรองความเสี่ยง
        <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}>
          <option value="">ทั้งหมด</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
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
      <KycQueueWorkspace
        items={items}
        selectedId={selectedId}
        onSelect={setSelectedId}
        state={state === 'SUCCESS' ? 'IDLE' : state}
        error={error}
        busy={busy}
        onApprove={(id) => postReview({ kycId: id, status: 'VERIFIED' })}
        onReject={(id, reason) => postReview({ kycId: id, status: 'REJECTED', rejectionReason: reason })}
      />
    </div>
  );
}

export default function AdminKycQueuePage() {
  return (
    <Suspense fallback={<p>กำลังโหลดพื้นที่ตรวจสอบ KYC…</p>}>
      <KycQueueInner />
    </Suspense>
  );
}
