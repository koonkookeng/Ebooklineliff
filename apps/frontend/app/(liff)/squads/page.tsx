// SSOT Phase 096 — LIFF squads hub (my squads + leaderboard)
// Canonical: apps/frontend/app/(liff)/squads/page.tsx
'use client';

import React, { Suspense, useState } from 'react';
import { useSquads } from '../../../hooks/useSquads';
import { StudySquadDashboard } from '../../../components/squad/StudySquadDashboard';
import { SquadLeaderboard } from '../../../components/squad/SquadLeaderboard';
import { squadApi } from '../../../lib/squad/squad-client';

function SquadsInner() {
  const { status, error, mine, detail, load, open, retry } = useSquads();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (busy || name.trim().length < 3) return;
    setBusy(true);
    try {
      await squadApi().create({ name: name.trim(), maxMembers: 5 });
      setName('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Study Squads</h1>
      {(status === 'LIFF_INIT' || status === 'LOADING') && !detail && <p aria-busy="true">กำลังโหลดกลุ่ม…</p>}
      {status === 'ERROR' && (
        <div>
          <p role="alert">{error ?? 'โหลดไม่สำเร็จ'}</p>
          <button type="button" onClick={retry}>
            ลองใหม่
          </button>
        </div>
      )}
      <div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อกลุ่ม เช่น AI Masterminds" maxLength={30} aria-label="ชื่อกลุ่ม" />
        <button type="button" onClick={() => void create()} disabled={busy || name.trim().length < 3}>
          {busy ? 'กำลังสร้าง…' : 'Create & Invite'}
        </button>
      </div>
      <ul>
        {mine.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => void open(s.id)}>
              {s.name}
            </button>
          </li>
        ))}
      </ul>
      {detail && <StudySquadDashboard squad={detail} />}
      <SquadLeaderboard scope="GLOBAL" timeframe="WEEKLY" />
    </div>
  );
}

export default function LiffSquadsPage() {
  return (
    <Suspense fallback={<p>กำลังเตรียม Study Squads…</p>}>
      <SquadsInner />
    </Suspense>
  );
}
