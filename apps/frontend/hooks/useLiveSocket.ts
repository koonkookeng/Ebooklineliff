// SSOT Phase 101 §2.2 — Live room socket hook (SSE + backoff reconnect)
// Canonical: apps/frontend/hooks/useLiveSocket.ts
// - RISK_CALL (transport): EventSource replaces the spec's WS client (banned
//   heavy dep). LIFF_INIT handshake -> IDLE room -> SUCCESS live events /
//   ERROR fallback + exponential-backoff reconnect (≤10s, §2.1).
// - Zero-dep (EventSource only).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type SocketStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface RoomEvent {
  event: string;
  payload: Record<string, unknown>;
}

export function useLiveSocket(sessionId: string | null, token: string | null) {
  const [status, setStatus] = useState<SocketStatus>('LIFF_INIT');
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [viewers, setViewers] = useState(0);
  const [nonce, setNonce] = useState(0);
  const backoff = useRef(1000);

  const push = useCallback((event: string, payload: Record<string, unknown>) => {
    if (event === 'live.viewers' && typeof payload['count'] === 'number') {
      setViewers(payload['count'] as number);
      return;
    }
    setEvents((prev) => [...prev.slice(-99), { event, payload }]);
    setStatus('SUCCESS');
  }, []);

  useEffect(() => {
    if (!sessionId || !token) {
      setStatus('ERROR');
      return;
    }
    setStatus('IDLE');
    let es: EventSource | null = null;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (closed) return;
      setStatus('LOADING');
      es = new EventSource(
        `/api/v1/live/sessions/${encodeURIComponent(sessionId)}/room/stream?token=${encodeURIComponent(token)}`,
      );
      es.onopen = () => {
        backoff.current = 1000;
        setStatus('IDLE');
      };
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse((ev as MessageEvent).data) as { event: string; payload: Record<string, unknown> };
          if (msg.event) push(msg.event, msg.payload ?? {});
        } catch {
          // ignore malformed frames
        }
      };
      es.onerror = () => {
        es?.close();
        if (closed) return;
        setStatus('ERROR');
        const wait = Math.min(backoff.current, 10000);
        backoff.current *= 2;
        timer = setTimeout(connect, wait);
      };
    };
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, token, nonce]);

  return { status, events, viewers, push, retry: () => setNonce((n) => n + 1) };
}
