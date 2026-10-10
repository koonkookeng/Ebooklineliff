// SSOT Phase 118 §6/Tasks 3-6 — admin audit console page (5-state)
// Canonical: apps/frontend/app/(admin)/dashboard/audit-logs/page.tsx
// - INIT (permission + chain status) -> IDLE (table + badge) -> LOADING
//   (fetch/re-verify) -> SUCCESS (delta diff + verified stamp) / ERROR
//   (red tamper banner + broken highlight). Dep-free.
// - Zero new deps.
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AdminAuditConsoleViewer } from '@/components/admin/audit-log-viewer';
import { auditApi, type AuditLogView, type AuditUiState } from '@/lib/audit/audit-client';

function AuditConsoleInner() {
  const params = useSearchParams();
  const tenant = params.get('tenant') ?? 'default';
  const viewerRole = params.get('role') ?? undefined;
  const [state, setState] = useState<AuditUiState>('INIT');
  const [logs, setLogs] = useState<AuditLogView[]>([]);
  const [chainValid, setChainValid] = useState<boolean | null>(null);
  const [tampered, setTampered] = useState<number[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState('');

  const load = useCallback(async () => {
    setState((s) => (s === 'INIT' ? s : 'LOADING'));
    setError(null);
    try {
      const [list, verdict] = await Promise.all([
        auditApi(tenant).logs({ actionCategory: category || undefined, page: 1, limit: 50 }),
        auditApi(tenant).verify(1000),
      ]);
      setLogs(list);
      setChainValid(verdict.valid);
      setTampered(verdict.tamperedBlockSequences);
      setState('SUCCESS');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลด audit ไม่สำเร็จ');
      setState('ERROR');
    }
  }, [tenant, category]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reverify() {
    setBusy(true);
    setState('LOADING');
    try {
      const verdict = await auditApi(tenant).verify(1000);
      setChainValid(verdict.valid);
      setTampered(verdict.tamperedBlockSequences);
      setState('SUCCESS');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ตรวจสอบไม่สำเร็จ');
      setState('ERROR');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'INIT') return <p>กำลังตรวจสอบสิทธิ์ + สถานะ hash chain…</p>;

  return (
    <div>
      <h1>Audit Log Explorer</h1>
      <label>
        กรองหมวด
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">ทั้งหมด</option>
          <option value="AUTHENTICATION">AUTHENTICATION</option>
          <option value="USER_MANAGEMENT">USER_MANAGEMENT</option>
          <option value="FINANCIAL_TRANSACTION">FINANCIAL_TRANSACTION</option>
          <option value="CONTENT_MUTATION">CONTENT_MUTATION</option>
          <option value="SYSTEM_CONFIGURATION">SYSTEM_CONFIGURATION</option>
          <option value="ENTITLEMENT_GRANT">ENTITLEMENT_GRANT</option>
        </select>
      </label>
      <button type="button" onClick={() => void reverify()} disabled={busy || state === 'LOADING'}>
        Re-verify Chain
      </button>
      {state === 'LOADING' && <p>กำลังตรวจสอบ…</p>}
      {state === 'ERROR' && (
        <p role="alert">
          {error ?? 'เกิดข้อผิดพลาด'}{' '}
          <button type="button" onClick={() => void load()}>
            ลองใหม่
          </button>
        </p>
      )}
      {state === 'SUCCESS' && chainValid && <p role="status" data-testid="verified-stamp">Hash Verified Stamp · ตรวจสอบผ่าน 100%</p>}
      <AdminAuditConsoleViewer
        logs={logs}
        chainValid={chainValid}
        tamperedSequences={tampered}
        viewerRole={viewerRole}
        onSelect={(l) => setSelectedId(l.id)}
        selectedId={selectedId}
      />
    </div>
  );
}

export default function AdminAuditLogsPage() {
  return (
    <Suspense fallback={<p>กำลังโหลด audit console…</p>}>
      <AuditConsoleInner />
    </Suspense>
  );
}
