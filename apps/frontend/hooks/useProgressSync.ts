// SSOT Phase 057 §6.1 + Phase 064 — Realtime + offline progress sync hook
// Canonical: apps/frontend/hooks/useProgressSync.ts
// - TRANSPORT NOTE (ADR-057): socket.io-client is NOT used.
//   Server→client: EventSource (SSE); client→server: throttled POST.
//   Offline: IndexedDB queue (Phase 064) + Background Sync API.
// - 5-state machine: SYNC_INIT → SYNC_IDLE → SYNC_PUSHING / SYNC_CONFLICT /
//   SYNC_ERROR (offline queue + max-progress flush on reconnect).
// - LIFF memory guard: EventSource closed + refs nulled; remote scalar-only.
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SYNC_CLIENT_THROTTLE_MS,
  isSyncPayloadWithinBudget,
  lastWriteWins,
} from '@repo/shared';
import { getPendingSyncCount, saveProgressToIndexedDB } from '../lib/offline/indexeddb-queue';
import { flushProgressQueue, registerProgressSync } from '../lib/offline/background-sync-manager';

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

/** Phase 064 offline fallback: single shared queue (indexeddb-queue). */
async function queueOffline(kind: 'ebook' | 'video', body: Record<string, unknown>): Promise<void> {
  try {
    if (kind === 'ebook') {
      const entityId = String(body['ebookId'] ?? body['productId'] ?? '');
      await saveProgressToIndexedDB('EBOOK_PAGE', entityId, body);
    } else {
      const entityId = String(body['lessonId'] ?? '');
      await saveProgressToIndexedDB('COURSE_LESSON', entityId, body);
    }
  } catch {
    // offline queue best-effort only
  }
}

export function useProgressSync({ tenantId, userId, deviceId, productId, enabled = true }: UseProgressSyncOptions) {
  const [uiState, setUiState] = useState<SyncUiState>('SYNC_INIT');
  const [remoteEbookPage, setRemoteEbookPage] = useState<RemoteEbookPage | null>(null);
  const [remoteVideoSec, setRemoteVideoSec] = useState<RemoteVideoSec | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const sourceRef = useRef<EventSource | null>(null);
  const lastEmitRef = useRef(0);
  const optsRef = useRef({ tenantId, userId, deviceId, productId });
  optsRef.current = { tenantId, userId, deviceId, productId };
  const localPageRef = useRef<{ page: number; at: number }>({ page: 0, at: 0 });
  const localVideoRef = useRef<{ sec: number; at: number }>({ sec: 0, at: 0 });

  const isConnected = uiState === 'SYNC_IDLE' || uiState === 'SYNC_PUSHING';

  // Phase 064: pending count from offline queue
  useEffect(() => {
    if (!enabled) return;
    getPendingSyncCount().then(setPendingCount);
    const unsub = (typeof BroadcastChannel !== 'undefined') ? (() => {
      const ch = new BroadcastChannel('offline-sync-channel');
      ch.onmessage = (e) => {
        if (e.data?.type === 'SYNC_COMPLETED') getPendingSyncCount().then(setPendingCount);
      };
      return () => ch.close();
    }) : (() => {});
    const handleOnlineFlush = () => void flushProgressQueue();
    window.addEventListener('online', handleOnlineFlush);
    return () => {
      window.removeEventListener('online', handleOnlineFlush);
      unsub?.();
    };
  }, [enabled]);

  // Phase 064: register background sync on online
  useEffect(() => {
    if (enabled) registerProgressSync();
  }, [enabled]);

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
      // Phase 064: queue on any failure (offline or mid-way request failure)
      await queueOffline(kind, body);
      getPendingSyncCount().then(setPendingCount);
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

  return { uiState, isConnected, remoteEbookPage, remoteVideoSec, emitEbookPageTurn, emitVideoTimeUpdate, dismissConflict, pendingCount };
}

export default useProgressSync;
