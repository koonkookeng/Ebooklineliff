// SSOT Phase 110 §6.1 — 360 inspector dashboard view (dep-free tabs)
// Canonical: apps/frontend/components/inspector/User360InspectorView.tsx
// - RISK_CALL: shadcn Card/Tabs + lucide-react + recharts are NOT installed —
//   same information architecture in Tailwind + inline SVG + CSS bars.
// - Zero new deps.
'use client';

import React, { useState } from 'react';
import { ReadingHeatmap } from './ReadingHeatmap';
import { VideoProgressList } from './VideoProgressList';
import { SecurityAuditTable } from './SecurityAuditTable';
import {
  fetchReadingHeatmap,
  fetchVideoAnalytics,
  revokeInspectorSessions,
  recalculateInspectorRfm,
  flagInspectorRisk,
  formatTHB,
  type InspectorProfile,
  type HeatCell,
  type VideoAnalytics,
} from '@/lib/inspector';

interface User360InspectorViewProps {
  profile: InspectorProfile;
  onChanged: (profile: InspectorProfile) => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}

type Tab = 'overview' | 'reading' | 'learning' | 'security';

const RISK_BADGE: Record<string, string> = {
  LOW: 'bg-slate-200 text-slate-700',
  MEDIUM: 'bg-amber-200 text-amber-800',
  HIGH: 'bg-orange-500 text-white',
  CRITICAL: 'bg-rose-600 text-white',
};

export const User360InspectorView: React.FC<User360InspectorViewProps> = ({ profile, onChanged, onToast, onError }) => {
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState(false);
  const [heatEbookId, setHeatEbookId] = useState(profile.recentReadingLogs[0]?.ebookId ?? '');
  const [heatCells, setHeatCells] = useState<HeatCell[] | null>(null);
  const [heatTitle, setHeatTitle] = useState('');
  const [courseId, setCourseId] = useState(profile.recentLearningLogs[0]?.courseId ?? '');
  const [video, setVideo] = useState<VideoAnalytics | null>(null);
  const [riskNote, setRiskNote] = useState('');
  const [riskLevel, setRiskLevel] = useState('HIGH');

  const reload = async (mutator: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await mutator();
      onToast(okMsg);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'ดำเนินการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const loadHeatmap = async () => {
    if (!heatEbookId) return;
    setBusy(true);
    try {
      const heat = await fetchReadingHeatmap(profile.userId, heatEbookId);
      setHeatCells(heat.cells);
      setHeatTitle(heat.bookTitle);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'โหลด heatmap ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const loadVideo = async () => {
    if (!courseId) return;
    setBusy(true);
    try {
      setVideo(await fetchVideoAnalytics(profile.userId, courseId));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'โหลด video analytics ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Overview & RFM' },
    { id: 'reading', label: 'E-Book Heatmap' },
    { id: 'learning', label: 'Course Progress' },
    { id: 'security', label: 'Security Logs' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-slate-900 dark:text-slate-50">
            {profile.displayName}
            <span className={`px-2 py-0.5 rounded text-xs ${RISK_BADGE[profile.riskLevel] ?? 'bg-gray-200'}`}>
              Risk: {profile.riskLevel}
            </span>
          </h1>
          <p className="text-sm text-slate-500">ID: {profile.userId} · LINE: {profile.lineUserId || 'N/A'} · {profile.email || 'no email'}</p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-xs text-slate-400">Lifetime Value (LTV)</p>
            <p className="text-xl font-bold text-emerald-500">{formatTHB(profile.lifetimeValueAmount)}</p>
          </div>
          <button
            disabled={busy}
            onClick={() => {
              if (!confirm('ยืนยันการยกเลิก Session ทั้งหมดของผู้ใช้นี้หรือไม่?')) return;
              reload(
                () => revokeInspectorSessions(profile.userId, 'Admin 1-click revoke จาก Inspector').then((r) => onToast(`ยกเลิก ${r.revokedSessionsCount} sessions แล้ว`)),
                'ยกเลิก Session เรียบร้อยแล้ว',
              );
            }}
            className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm hover:bg-rose-700 disabled:opacity-50"
          >
            Revoke Sessions
          </button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.id ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <p className="text-sm text-slate-500">RFM Segment</p>
            <p className="text-2xl font-bold text-amber-500">{profile.rfmScore.segmentLabel}</p>
            <p className="text-xs text-slate-400 mt-1">R: {profile.rfmScore.recencyScore} · F: {profile.rfmScore.frequencyScore} · M: {profile.rfmScore.monetaryScore}</p>
            <button
              disabled={busy}
              onClick={() => reload(
                () => recalculateInspectorRfm(profile.userId).then((s) => onChanged({ ...profile, rfmScore: s })),
                'คำนวณ RFM ใหม่แล้ว',
              )}
              className="mt-3 text-xs px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              คำนวณ RFM ใหม่
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <p className="text-sm text-slate-500">Total Orders</p>
            <p className="text-2xl font-bold text-blue-500">{profile.totalOrdersCount} Orders</p>
            <p className="text-xs text-slate-400 mt-1">Wallet: {formatTHB(profile.walletBalance)} · {profile.rewardPoints} points</p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <p className="text-sm text-slate-500">Flag Risk Level</p>
            <div className="mt-2 flex gap-2">
              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((r) => (
                <button
                  key={r}
                  onClick={() => setRiskLevel(r)}
                  className={`px-2 py-1 rounded text-xs border ${riskLevel === r ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'border-slate-300 dark:border-slate-600'}`}
                >
                  {r}
                </button>
              ))}
            </div>
            <input
              value={riskNote}
              onChange={(e) => setRiskNote(e.target.value)}
              placeholder="หมายเหตุ (≥ 5 ตัวอักษร)"
              className="mt-2 w-full px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
            />
            <button
              disabled={busy || riskNote.trim().length < 5}
              onClick={() => reload(
                () => flagInspectorRisk(profile.userId, riskLevel, riskNote.trim()).then((r) => onChanged({ ...profile, riskLevel: r.updatedRiskLevel })),
                `Flag risk เป็น ${riskLevel} แล้ว`,
              )}
              className="mt-2 text-xs px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-white dark:text-slate-900 disabled:opacity-50"
            >
              ยืนยัน Flag
            </button>
          </div>
        </div>
      )}

      {tab === 'reading' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={heatEbookId}
              onChange={(e) => setHeatEbookId(e.target.value)}
              placeholder="E-Book ID"
              className="flex-1 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
            />
            <button onClick={loadHeatmap} disabled={busy || !heatEbookId} className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white disabled:opacity-50">
              โหลด Heatmap
            </button>
          </div>
          {profile.recentReadingLogs.length > 0 && (
            <div className="space-y-2">
              {profile.recentReadingLogs.map((log, i) => (
                <div key={`${log.ebookId}-${log.pageNumber}-${i}`} className="flex justify-between items-center p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm">
                  <span className="truncate">{log.bookTitle} (หน้า {log.pageNumber})</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{log.dwellTimeSeconds}s</span>
                </div>
              ))}
            </div>
          )}
          {heatCells && <ReadingHeatmap cells={heatCells} bookTitle={heatTitle} />}
        </div>
      )}

      {tab === 'learning' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              placeholder="Course ID"
              className="flex-1 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
            />
            <button onClick={loadVideo} disabled={busy || !courseId} className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white disabled:opacity-50">
              โหลด Progress
            </button>
          </div>
          <VideoProgressList analytics={video} />
        </div>
      )}

      {tab === 'security' && <SecurityAuditTable logs={profile.recentSecurityLogs} />}
    </div>
  );
};

export default User360InspectorView;
