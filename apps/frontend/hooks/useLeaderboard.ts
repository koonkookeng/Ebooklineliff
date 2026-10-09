// SSOT Phase 096 BDD-3 — Leaderboard hook (5-state, windowed rows)
// Canonical: apps/frontend/hooks/useLeaderboard.ts
// - Caps rendered rows at 50 (windowing discipline, Gate 5).
// - Zero-dep beyond the squad client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { squadApi, type BoardEntry, type SquadStatus } from '../lib/squad/squad-client';

const BOARD_WINDOW = 50;

export function useLeaderboard(scope = 'GLOBAL', timeframe = 'WEEKLY') {
  const [status, setStatus] = useState<SquadStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<BoardEntry[]>([]);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    setStatus('LOADING');
    setError(null);
    try {
      const rows = await squadApi().board(scope, timeframe, BOARD_WINDOW);
      setEntries(rows.slice(0, BOARD_WINDOW));
      setStatus('SUCCESS');
    } catch (e) {
      setStatus('ERROR');
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, timeframe, nonce]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  return { status, error, entries, retry: () => setNonce((n) => n + 1) };
}
