// SSOT Phase 024 Task 8 — Admin dispatch console (5-state monitor + live preview)
// Canonical: apps/frontend/app/(admin)/notifications/page.tsx
// (legacy src/frontend/app/(admin)/notifications/page.tsx)
// States: MSG_INIT (skeleton) → QUEUED/DISPATCHING (live counts) →
// DELIVERED_SUCCESS / DISPATCH_FAILED (+FALLBACK_SENT) rows. ERROR → retry.
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FlexMessagePreview } from '../../../components/flex-builder/FlexMessagePreview';

type PageState = 'MSG_INIT' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface LogRow {
  id: string;
  messageType: string;
  status: string;
  retryCount: number;
  createdAt: string;
}

const STATUSES = ['QUEUED', 'PROCESSING', 'DELIVERED', 'FAILED', 'FALLBACK_SENT'];

const SAMPLE_TEMPLATE: Record<string, unknown> = {
  type: 'bubble',
  header: { text: '{{shopName}} แจ้งชำระเงินสำเร็จ' },
  body: { text: 'คำสั่งซื้อ {{orderNumber}} จำนวน {{amount}} บาท' },
  footer: { buttonUrl: '{{downloadUrl}}', buttonLabel: 'เข้าคลังหนังสือ' },
};

const SAMPLE_DATA: Record<string, string> = {
  shopName: 'Ebook LIFF',
  orderNumber: 'ORD-0001',
  amount: '299',
  downloadUrl: 'https://liff.example.com/library',
};

function AdminNotificationsInner() {
  const params = useSearchParams();
  const tenantId = params.get('tenant') ?? 'default';
  const [state, setState] = useState<PageState>('MSG_INIT');
  const [stats, setStats] = useState<Record<string, number>>({});
  const [logs, setLogs] = useState<LogRow[]>([]);

  const load = useCallback(async () => {
    setState('LOADING');
    try {
      const [statsRes, logsRes] = await Promise.all([
        fetch(`/api/v1/admin/notifications/stats?tenantId=${encodeURIComponent(tenantId)}`),
        fetch(`/api/v1/admin/notifications/logs?tenantId=${encodeURIComponent(tenantId)}`),
      ]);
      if (!statsRes.ok || !logsRes.ok) throw new Error('console unavailable');
      setStats((await statsRes.json()) as Record<string, number>);
      setLogs((await logsRes.json()) as LogRow[]);
      setState('SUCCESS');
    } catch {
      setState('ERROR');
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'MSG_INIT' || state === 'LOADING') {
    return (
      <main className="p-6">
        <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 grid grid-cols-5 gap-2">
          {STATUSES.map((s) => (
            <div key={s} className="h-16 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      </main>
    );
  }

  if (state === 'ERROR') {
    return (
      <main className="p-6 text-center">
        <p className="text-sm text-slate-500">โหลดข้อมูล dispatch ไม่สำเร็จ</p>
        <button
          type="button"
          onClick={load}
          className="mt-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
        >
          ลองใหม่อีกครั้ง
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-lg font-bold">Service Message Dispatch · {tenantId}</h1>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {STATUSES.map((s) => (
          <div key={s} className="rounded-lg border p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{s}</div>
            <div className="text-2xl font-bold">{stats[s] ?? 0}</div>
          </div>
        ))}
      </div>

      <h2 className="mt-6 text-sm font-bold">Recent dispatches</h2>
      <ul className="mt-2 divide-y rounded-lg border">
        {logs.map((log) => (
          <li key={log.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="font-mono text-xs">{log.id.slice(0, 8)}</span>
            <span>{log.messageType}</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{log.status}</span>
            <span className="text-xs text-slate-500">retry {log.retryCount}</span>
          </li>
        ))}
        {logs.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">ยังไม่มีการส่งข้อความ</li>}
      </ul>

      <h2 className="mt-6 text-sm font-bold">Template preview</h2>
      <div className="mt-2">
        <FlexMessagePreview templateJson={SAMPLE_TEMPLATE} sampleData={SAMPLE_DATA} />
      </div>
    </main>
  );
}

export default function AdminNotificationsPage() {
  return (
    <Suspense fallback={<main className="p-6">กำลังโหลด…</main>}>
      <AdminNotificationsInner />
    </Suspense>
  );
}
