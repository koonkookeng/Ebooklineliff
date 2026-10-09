// SSOT Phase 096 BDD-1 — Squad hook (5-state, create/join/detail)
// Canonical: apps/frontend/hooks/useSquads.ts
// - Zero-dep beyond the squad client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { squadApi, type SquadDetail, type SquadStatus } from '../lib/squad/squad-client';

export function useSquads() {
  const [status, setStatus] = useState<SquadStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<Array<{ id: string; name: string }>>([]);
  const [detail, setDetail] = useState<SquadDetail | null>(null);

  const load = useCallback(async () => {
    setStatus('LOADING');
    setError(null);
    try {
      const rows = await squadApi().mine();
      setMine(rows);
      setStatus('IDLE');
    } catch (e) {
      setStatus('ERROR');
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function open(squadId: string): Promise<void> {
    setStatus('LOADING');
    try {
      setDetail(await squadApi().detail(squadId));
      setStatus('SUCCESS');
    } catch (e) {
      setStatus('ERROR');
      setError((e as Error).message);
    }
  }

  return { status, error, mine, detail, load, open, retry: () => void load() };
}
