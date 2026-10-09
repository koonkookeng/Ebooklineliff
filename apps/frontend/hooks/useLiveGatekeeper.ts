// SSOT Phase 100 §2.2 — Gatekeeper hook (5-state + kick overlay)
// Canonical: apps/frontend/hooks/useLiveGatekeeper.ts
// - LIFF_INIT -> LOADING token -> SUCCESS player / ERROR paywall;
//   15s heartbeat + SSE kick listener halt playback instantly (<2s).
// - Zero-dep beyond the gate client.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gateApi, type GateAccess, type GateStatus } from '../lib/stream/live-gatekeeper-client';

export function useLiveGatekeeper(liveRoomId: string | null, userId: string | null) {
  const [status, setStatus] = useState<GateStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<GateAccess | null>(null);
  const [kickReason, setKickReason] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (!liveRoomId || busy.current) return;
    busy.current = true;
    setStatus('LOADING');
    setError(null);
    setKickReason(null);
    try {
      const data = await gateApi().token(liveRoomId);
      if (data.accessStatus !== 'GRANTED' || !data.hlsStreamUrl) {
        setStatus('ERROR');
        setError(data.accessStatus);
        return;
      }
      setAccess(data);
      setStatus('SUCCESS');
    } catch (e) {
      setStatus('ERROR');
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRoomId, nonce]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // Kick listener: SSE push halts playback inside 2s (BDD-2).
  useEffect(() => {
    if (!liveRoomId || !userId || status !== 'SUCCESS') return;
    const es = gateApi().kickStream(liveRoomId, userId);
    es.addEventListener('LIVE_SESSION_KICK', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { reason?: string };
        setKickReason(data.reason ?? 'KICKED');
      } catch {
        setKickReason('KICKED');
      }
      setStatus('ERROR');
    });
    return () => es.close();
  }, [liveRoomId, userId, status]);

  function onKicked(reason: string) {
    setKickReason(reason);
    setStatus('ERROR');
  }

  return { status, error, access, kickReason, onKicked, retry: () => setNonce((n) => n + 1) };
}
