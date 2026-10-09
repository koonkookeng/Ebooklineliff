// SSOT Phase 096 — LIFF squad room page (detail + board)
// Canonical: apps/frontend/app/(liff)/squads/[squadId]/page.tsx
'use client';

import React, { Suspense, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useSquads } from '../../../../hooks/useSquads';
import { StudySquadDashboard } from '../../../../components/squad/StudySquadDashboard';
import { SquadLeaderboard } from '../../../../components/squad/SquadLeaderboard';

function SquadRoomInner() {
  const params = useParams<{ squadId: string }>();
  const { status, error, detail, open, retry } = useSquads();

  useEffect(() => {
    void open(params.squadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.squadId]);

  if (status === 'ERROR' || (!detail && status !== 'LOADING' && status !== 'LIFF_INIT')) {
    return (
      <div>
        <p role="alert">{error ?? 'ไม่พบกลุ่ม'}</p>
        <button type="button" onClick={retry}>
          ลองใหม่
        </button>
      </div>
    );
  }

  if (!detail) return <p aria-busy="true">กำลังโหลดกลุ่ม…</p>;

  return (
    <div>
      <StudySquadDashboard squad={detail} />
      <SquadLeaderboard scope="SQUAD" timeframe="WEEKLY" />
    </div>
  );
}

export default function LiffSquadRoomPage() {
  return (
    <Suspense fallback={<p>กำลังโหลดกลุ่ม…</p>}>
      <SquadRoomInner />
    </Suspense>
  );
}
