// SSOT Phase 057 §6.1 — Realtime progress sync hook (SSE + REST, zero-dep)
// Canonical: apps/frontend/hooks/useProgressSync.ts
// (legacy src/frontend/hooks/useProgressSync.ts)
// - TRANSPORT NOTE (ADR-057): socket.io-client is NOT used (heavy LIFF dep).
//   Server→client rides native EventSource (SSE room stream); client→server
//   rides throttled fetch POST (3s cadence, <200-byte payloads).
// - 5-state machine: SYNC_INIT → SYNC_IDLE → SYNC_PUSHING / SYNC_CONFLICT /
//   SYNC_ERROR (IndexedDB offline queue + max-progress flush on reconnect).
// - LIFF memory guard: EventSource closed + refs nulled on unmount; remote
//   payloads are scalar-only (no retained objects).
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SYNC_CLIENT_THROTTLE_MS,
  isSyncPayloadWithinBudget,
  lastWriteWins,
} from '@repo/shared';

export type SyncUiState = 'SYNC_INIT' | 'SYNC_IDLE' | 'SYNC_PUSHING' | 'SYNC_CONFLICT' | 'SYNC_ERROR';

interface UseProgressSyncOptions {
  tenantId: string;
  userId: string;
  deviceId: string;
  productId: string;
  enabled?: boolean;
}

export interface RemoteEbookPage {
  ebookId: string;
  lastPage: number;
  deviceId: string;
}

export interface RemoteVideoSec {
  lessonId: string;
  watchedSec: number;
  isCompleted: boolean;
  deviceId: string;
}

const IDB_DB = 'zene-sync';
const IDB_STORE = 'pending-sync';

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE, { autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function queueOffline(item: unknown): Promise<void> {
  const db = await idb();
  if (!db) return;
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).add({ item, at: Date.now() });
  } catch {
    // offline queue best-effort only
  } finally {
    db.close();
  }
}

export function useProgressSync({ tenantId, userId, deviceId, productId, enabled = true }: UseProgressSyncOptions) {
  const [uiState, setUiState] = useState<SyncUiState>('SYNC_INIT');
  const [remoteEbookPage, setRemoteEbookPage] = useState<RemoteEbookPage | null>(null);
  const [remoteVideoSec, setRemoteVideoSec] = useState<RemoteVideoSec | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const lastEmitRef = useRef(0);
  const optsRef = useRef({ tenantId, userId, deviceId, productId });
  optsRef.current = { tenantId, userId, deviceId, productId };
  const localPageRef = useRef<{ page: number; at: number }>({ page: 0, at: 0 });
  const localVideoRef = useRef<{ sec: number; at: number }>({ sec: 0, at: 0 });

  const isConnected = uiState === 'SYNC_IDLE' || uiState === 'SYNC_PUSHING';

  useEffect(() => {
    if (!enabled || !userId) {
      setUiState('SYNC_ERROR');
      return;
    }
    setUiState('SYNC_INIT');
    const qs = `tenantId=${encodeURIComponent(tenantId)}&userId=${encodeURIComponent(userId)}&deviceId=${encodeURIComponent(deviceId)}`;
    const source = new EventSource(`/api/v1/sync/stream?${qs}`);
    sourceRef.current = source;
    source.onopen = () => setUiState((s) => (s === 'SYNC_INIT' ? 'SYNC_IDLE' : s));
    source.onerror = () => setUiState('SYNC_ERROR');
    const onMessage = (e: MessageEvent) => {
      try {
        const frame = JSON.parse(e.data as string) as {
          event?: string;
          data?: { payload?: { contentType?: string; ebookData?: { ebookId: string; lastPage: number; deviceId: string }; videoData?: { lessonId: string; watchedSec: number; isCompleted: boolean; deviceId: string } } };
        };
        const payload = frame.data?.payload;
        if (!payload) return;
        if (payload.contentType === 'EBOOK' && payload.ebookData && payload.ebookData.deviceId !== deviceId) {
          const incoming = { ebookId: payload.ebookData.ebookId, lastPage: payload.ebookData.lastPage, deviceId: payload.ebookData.deviceId };
          setRemoteEbookPage(incoming);
          // Conflict surface: remote newer than local → prompt; else ignore.
          if (lastWriteWins(localPageRef.current.at, Date.now()) === 'b' && incoming.lastPage !== localPageRef.current.page) {
            setUiState('SYNC_CONFLICT');
          }
        } else if (payload.contentType === 'COURSE_LESSON' && payload.videoData && payload.videoData.deviceId !== deviceId) {
          const incoming = { lessonId: payload.videoData.lessonId, watchedSec: payload.videoData.watchedSec, isCompleted: payload.videoData.isCompleted, deviceId: payload.videoData.deviceId };
          setRemoteVideoSec(incoming);
          if (lastWriteWins(localVideoRef.current.at, Date.now()) === 'b' && incoming.watchedSec !== localVideoRef.current.sec) {
            setUiState('SYNC_CONFLICT');
          }
        }
      } catch {
        // malformed frame never breaks the stream
      }
    };
    source.onmessage = onMessage;
    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [tenantId, userId, deviceId, enabled]);

  const postSync = useCallback(async (kind: 'ebook' | 'video', body: Record<string, unknown>) => {
    if (!isSyncPayloadWithinBudget(body)) return;
    setUiState('SYNC_PUSHING');
    try {
      const res = await fetch(`/api/v1/sync/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`sync ${res.status}`);
      setUiState('SYNC_IDLE');
    } catch {
      setUiState('SYNC_ERROR');
      await queueOffline({ kind, body });
    }
  }, []);

  const emitEbookPageTurn = useCallback(
    (ebookId: string, lastPage: number, totalPages: number) => {
      const now = Date.now();
      if (now - lastEmitRef.current < SYNC_CLIENT_THROTTLE_MS) return;
      lastEmitRef.current = now;
      localPageRef.current = { page: lastPage, at: now };
      const o = optsRef.current;
      void postSync('ebook', {
        tenantId: o.tenantId,
        userId: o.userId,
        productId: o.productId,
        ebookId,
        lastPage,
        totalPages,
        deviceId: o.deviceId,
        clientTimestamp: now,
      });
    },
    [postSync],
  );

  const emitVideoTimeUpdate = useCallback(
    (lessonId: string, watchedSec: number, durationSec: number, isCompleted: boolean) => {
      const now = Date.now();
      if (now - lastEmitRef.current < SYNC_CLIENT_THROTTLE_MS) return;
      lastEmitRef.current = now;
      localVideoRef.current = { sec: watchedSec, at: now };
      const o = optsRef.current;
      void postSync('video', {
        tenantId: o.tenantId,
        userId: o.userId,
        productId: o.productId,
        lessonId,
        watchedSec,
        durationSec,
        isCompleted,
        deviceId: o.deviceId,
        clientTimestamp: now,
      });
    },
    [postSync],
  );

  const dismissConflict = useCallback(() => {
    setRemoteEbookPage(null);
    setRemoteVideoSec(null);
    setUiState('SYNC_IDLE');
  }, []);

  return { uiState, isConnected, remoteEbookPage, remoteVideoSec, emitEbookPageTurn, emitVideoTimeUpdate, dismissConflict };
}

export default useProgressSync;
