// SSOT Phase 120 §6/Tasks 7-8 — unusual-activity center (5-state)
// Canonical: apps/frontend/app/(liff)/security/unusual-activity/page.tsx
// - LIFF_INIT (tenant splash) -> IDLE (history + verify state) -> LOADING
//   (verdict/OTP/block) -> SUCCESS (toast + store update + sheet close) /
//   ERROR (red fallback + support CTA). Text-only, <30MB.
// - Transport: single Next proxy (GraphQL passthrough, fixed documents).
// - Zero new deps.
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LoginHistoryModal, UnusualActivitySheet, type LoginHistoryEntry } from '@/components/security/login-history-modal';

type SecurityUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

interface VerdictView {
  actionRequired: 'ALLOW' | 'REQUIRE_MFA' | 'BLOCK';
  riskScore: number;
  riskLevel: string;
  anomalyType: string;
}

async function postAnomaly<T>(tenant: string, operation: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/v1/security/anomaly?tenant=${encodeURIComponent(tenant)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ operation, params }),
  });
  if (!res.ok) throw new Error(`security ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

function SecurityInner() {
  const params = useSearchParams();
  const tenant = params.get('tenant') ?? 'default';
  const [state, setState] = useState<SecurityUiState>('LIFF_INIT');
  const [history, setHistory] = useState<LoginHistoryEntry[]>([]);
  const [verdict, setVerdict] = useState<VerdictView | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await postAnomaly<LoginHistoryEntry[]>(tenant, 'history', { limit: 20 });
      setHistory(rows);
      setState('IDLE');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดประวัติไม่สำเร็จ');
      setState('ERROR');
    }
  }, [tenant]);

  useEffect(() => {
    void load();
  }, [load]);

  async function checkCurrent() {
    setState('LOADING');
    setError(null);
    try {
      const out = await postAnomaly<VerdictView>(tenant, 'report', {});
      setVerdict(out);
      setState(out.actionRequired === 'ALLOW' ? 'IDLE' : 'SUCCESS');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ตรวจสอบไม่สำเร็จ');
      setState('ERROR');
    }
  }

  async function blockSelf() {
    setState('LOADING');
    try {
      await postAnomaly<boolean>(tenant, 'block', {});
      setToast('บล็อกเซสชันที่ผิดปกติเรียบร้อยแล้ว');
      setState('SUCCESS');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บล็อกไม่สำเร็จ');
      setState('ERROR');
    }
  }

  if (state === 'LIFF_INIT') return <p>กำลังโหลดศูนย์ความปลอดภัย…</p>;

  const latest = history[0];
  const showSheet = verdict !== null && verdict.actionRequired !== 'ALLOW';

  return (
    <div>
      <h1>ความปลอดภัยบัญชี</h1>
      <button type="button" onClick={() => void checkCurrent()} disabled={state === 'LOADING'}>
        ตรวจสอบเซสชันปัจจุบัน
      </button>
      <button type="button" onClick={() => setShowHistory(true)}>
        ประวัติการเข้าใช้งาน ({history.length})
      </button>
      {state === 'LOADING' && <p>กำลังตรวจสอบ…</p>}
      {state === 'SUCCESS' && toast && <p role="status">{toast}</p>}
      {state === 'SUCCESS' && verdict && (
        <p role="status" data-testid="verdict-line">
          {verdict.anomalyType} · เสี่ยง {verdict.riskScore} ({verdict.riskLevel})
        </p>
      )}
      {state === 'ERROR' && (
        <p role="alert">
          {error ?? 'เกิดข้อผิดพลาด'}{' '}
          <button type="button" onClick={() => void load()}>
            ลองใหม่
          </button>{' '}
          <button type="button" onClick={() => setState('IDLE')}>
            ติดต่อฝ่ายซัพพอร์ต
          </button>
        </p>
      )}
      {showHistory && <LoginHistoryModal entries={history} onClose={() => setShowHistory(false)} />}
      {showSheet && latest && (
        <UnusualActivitySheet
          activity={{
            location: `${latest.city ?? '—'}, ${latest.countryCode ?? '—'}`,
            ipAddress: latest.ipAddress,
            device: navigator.userAgent,
            riskLevel: (verdict?.riskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH') as 'HIGH' | 'CRITICAL',
          }}
          busy={state === 'LOADING'}
          onBlockSession={blockSelf}
          onVerifySelf={() => {
            setVerdict(null);
            setToast('ยืนยันตัวตนสำเร็จ');
            setState('SUCCESS');
          }}
        />
      )}
    </div>
  );
}

export default function UnusualActivityPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดศูนย์ความปลอดภัย…</p>}>
      <SecurityInner />
    </Suspense>
  );
}
