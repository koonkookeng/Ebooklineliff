// SSOT Phase 110 §6 — 360 inspector page shell (5-state machine)
// Canonical: apps/frontend/app/(admin)/users/[id]/inspector/page.tsx
// States: INSPECTOR_INIT (skeleton) → IDLE → LOADING (overlay) →
// SUCCESS (toast) / ERROR (diagnostics + retry). Zero new deps.
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { User360InspectorView } from '@/components/inspector/User360InspectorView';
import { fetchInspectorProfile, fetchAnomaly, type InspectorProfile } from '@/lib/inspector';

type PageState = 'INSPECTOR_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export default function UserInspectorPage() {
  const params = useParams<{ id: string }>();
  const userId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [state, setState] = useState<PageState>('INSPECTOR_INIT');
  const [profile, setProfile] = useState<InspectorProfile | null>(null);
  const [anomaly, setAnomaly] = useState<{ anomalous: boolean; state: string | null; distinctIps: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setState((s) => (s === 'INSPECTOR_INIT' ? s : 'LOADING'));
    try {
      const [p, a] = await Promise.all([fetchInspectorProfile(userId), fetchAnomaly(userId).catch(() => null)]);
      setProfile(p);
      setAnomaly(a);
      setError(null);
      setState('IDLE');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลด 360 profile ไม่สำเร็จ');
      setState('ERROR');
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (msg: string) => {
    setToast(msg);
    setState('SUCCESS');
    window.setTimeout(() => setState('IDLE'), 2200);
  };

  const fail = (msg: string) => {
    setError(msg);
    setState('ERROR');
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <p className="text-xs text-slate-500 mb-2">Admin · 360° User Inspector</p>

        {state === 'INSPECTOR_INIT' && (
          <div className="space-y-4 animate-pulse" aria-busy="true">
            <div className="h-28 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
            <div className="grid grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => <div key={i} className="h-32 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />)}
            </div>
          </div>
        )}

        {state === 'ERROR' && !profile && (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-6 text-sm text-rose-700" role="alert">
            <p className="font-bold">โหลดข้อมูลไม่สำเร็จ{error ? `: ${error}` : ''}</p>
            <p className="text-xs mt-1">Error code: INSPECTOR_FETCH_FAILED · ตรวจสอบสิทธิ์/เครือข่ายแล้วลองใหม่</p>
            <button onClick={load} className="mt-3 px-4 py-2 rounded-lg bg-rose-600 text-white text-sm">Retry Sync</button>
          </div>
        )}

        {profile && state !== 'INSPECTOR_INIT' && (
          <>
            {anomaly?.anomalous && (
              <div className="mb-4 rounded-xl border border-orange-400 bg-orange-50 p-4 text-sm text-orange-800" role="alert">
                ตรวจพบ SUSPICIOUS_CONCURRENCY — {anomaly.distinctIps.length} IPs ใน 60 วินาที · แนะนำ Revoke Sessions ทันที
              </div>
            )}
            {toast && state === 'SUCCESS' && (
              <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700" role="status">{toast}</div>
            )}
            {error && state === 'ERROR' && (
              <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700" role="alert">
                {error} <button onClick={load} className="ml-2 underline">Retry</button>
              </div>
            )}
            <div className="relative">
              {state === 'LOADING' && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50 dark:bg-slate-950/50 rounded-xl">
                  <span className="h-8 w-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" aria-label="กำลังโหลด" />
                </div>
              )}
              <User360InspectorView profile={profile} onChanged={setProfile} onToast={flash} onError={fail} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
