// SSOT Phase 096 Task 7 — Virtualized leaderboard list (windowed, dep-free)
// Canonical: apps/frontend/components/squad/SquadLeaderboard.tsx
// - Renders max 50 windowed rows (Gate 5: no 10k-row DOM). Zero-dep.
'use client';

import React from 'react';
import { useLeaderboard } from '../../hooks/useLeaderboard';

export function SquadLeaderboard(props: { scope?: string; timeframe?: string }) {
  const { status, error, entries, retry } = useLeaderboard(props.scope, props.timeframe);

  if (status === 'LIFF_INIT' || status === 'LOADING') {
    return (
      <div aria-busy="true">
        <p>กำลังโหลดตารางอันดับ…</p>
      </div>
    );
  }

  if (status === 'ERROR') {
    return (
      <div>
        <p role="alert">{error ?? 'โหลดอันดับไม่สำเร็จ'}</p>
        <button type="button" onClick={retry}>
          ลองใหม่
        </button>
      </div>
    );
  }

  return (
    <div>
      <h3>Leaderboard ({props.scope ?? 'GLOBAL'} / {props.timeframe ?? 'WEEKLY'})</h3>
      <ol>
        {entries.map((e) => (
          <li key={e.entityId}>
            <span>#{e.rank}</span> <span>{e.displayName}</span> <span>{e.score.toLocaleString('th-TH')}</span>
            {e.isCurrentUser ? <span> (คุณ)</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export default SquadLeaderboard;
