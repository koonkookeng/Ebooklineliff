// SSOT Phase 099 §2.2 — Live session hook (5-state, single-join guard)
// Canonical: apps/frontend/hooks/useLiveSession.ts
// - LIFF_INIT splash -> LOADING join handshake -> SUCCESS stream /
//   ERROR fallback (unentitled/network + buy drawer signal).
// - Zero-dep beyond the live client.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { liveApi, type LiveAccess, type LiveStatus } from '../lib/live/live-client';

export function useLiveSession(sessionId: string | null) {
  const [status, setStatus] = useState<LiveStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<LiveAccess | null>(null);
  const [nonce, setNonce] = useState(0);
  const joining = useRef(false);

  const join = useCallback(async () => {
    if (!sessionId || joining.current) return;
    joining.current = true;
    setStatus('LOADING');
    setError(null);
    try {
      setAccess(await liveApi().join(sessionId));
      setStatus('SUCCESS');
    } catch (e) {
      setStatus('ERROR');
      setError((e as Error).message);
    } finally {
      joining.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, nonce]);

  useEffect(() => {
    const t = setTimeout(() => void join(), 0);
    return () => clearTimeout(t);
  }, [join]);

  return { status, error, access, retry: () => setNonce((n) => n + 1) };
}
