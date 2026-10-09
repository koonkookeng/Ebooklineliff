// SSOT Phase 098 §2.2 — HR dashboard hook (5-state, retry-safe)
// Canonical: apps/frontend/hooks/useHrDashboard.ts
// - HR_INIT splash -> LOADING fetch -> SUCCESS grid / ERROR fallback+retry.
// - Zero-dep beyond the hr client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { hrApi, type HrDashboard, type HrStatus } from '../lib/b2b-hr/hr-client';

export function useHrDashboard(orgId: string | null) {
  const [status, setStatus] = useState<HrStatus>('HR_INIT');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<HrDashboard | null>(null);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    if (!orgId) {
      setStatus('ERROR');
      setError('Missing organization');
      return;
    }
    setStatus('LOADING');
    setError(null);
    try {
      setData(await hrApi().dashboard(orgId));
      setStatus('SUCCESS');
    } catch (e) {
      setStatus('ERROR');
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, nonce]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  return { status, error, data, reload: () => setNonce((n) => n + 1) };
}
