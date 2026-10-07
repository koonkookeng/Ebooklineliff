// SSOT Phase 046 Task 4 — useVideoProgressSync (5s heartbeat + beacon, §6.1)
// Canonical: apps/frontend/components/video/hooks/useVideoProgressSync.ts
// (legacy src/frontend/components/video/hooks/useVideoProgressSync.ts)
// - Deduplicates identical seconds, drives a 5s interval while playing,
//   flushes via sendBeacon on unload/hide (BDD offline queueing), and queues
//   failures to guarded localStorage for retry on reconnect (§10.2).
// - Timer/listener hygiene on unmount (Gate 5 <30MB, no leaks).
// - Zero new deps (react only).
'use client';

import { useCallback, useEffect, useRef } from 'react';
import { PROGRESS_SYNC_INTERVAL_MS } from '@repo/shared';

interface UseVideoProgressSyncProps {
  lessonId: string;
  userId: string;
  token: string;
  intervalMs?: number;
}

interface QueuedSync {
  lessonId: string;
  watchedSec: number;
  durationSec: number;
  isCompleted: boolean;
  clientTimestamp: string;
}

const QUEUE_KEY = 'video-progress-offline-queue-v1';
const MAX_QUEUE = 50;

function readQueue(): QueuedSync[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as QueuedSync[]).slice(0, MAX_QUEUE) : [];
  } catch {
    return [];
  }
}

function writeQueue(rows: QueuedSync[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(rows.slice(0, MAX_QUEUE)));
  } catch {
    // Storage pressure must never break playback.
  }
}

export function enqueueOfflineSync(entry: QueuedSync): void {
  writeQueue([...readQueue(), entry]);
}

export async function flushOfflineQueue(): Promise<number> {
  const rows = readQueue();
  let sent = 0;
  for (const entry of rows) {
    try {
      const res = await fetch('/api/v1/stream/progress/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (res.ok) sent += 1;
      else break;
    } catch {
      break;
    }
  }
  if (sent > 0) writeQueue(rows.slice(sent));
  return sent;
}

export function useVideoProgressSync({ lessonId, userId, token, intervalMs = PROGRESS_SYNC_INTERVAL_MS }: UseVideoProgressSyncProps) {
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSyncedRef = useRef<number>(-1);
  const latestRef = useRef({ lessonId, userId, token });
  latestRef.current = { lessonId, userId, token };

  const executeSync = useCallback(async (currentTime: number, duration: number, isBeacon = false): Promise<void> => {
    const { lessonId: lid, userId: uid, token: tok } = latestRef.current;
    const roundedTime = Math.floor(Math.max(0, currentTime));
    const durationSec = Math.floor(Math.max(0, duration));
    if (roundedTime === lastSyncedRef.current && !isBeacon) return;
    if (durationSec <= 0) return;
    const payload = {
      userId: uid,
      input: {
        lessonId: lid,
        watchedSec: roundedTime,
        durationSec,
        isCompleted: roundedTime >= Math.floor(durationSec * 0.95),
        clientTimestamp: new Date().toISOString(),
      },
    };
    if (isBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon('/api/v1/stream/progress/beacon', blob);
      } catch {
        enqueueOfflineSync({ ...payload.input });
      }
      lastSyncedRef.current = roundedTime;
      return;
    }
    try {
      const res = await fetch('/api/v1/stream/progress/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify(payload.input),
      });
      if (!res.ok) throw new Error(`sync ${res.status}`);
      lastSyncedRef.current = roundedTime;
      if (typeof window !== 'undefined') void flushOfflineQueue().catch(() => undefined);
    } catch {
      enqueueOfflineSync({ ...payload.input });
    }
  }, []);

  const startSyncTimer = useCallback(
    (getCurrentTime: () => number, getDuration: () => number) => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      syncTimerRef.current = setInterval(() => {
        const currentTime = getCurrentTime();
        const duration = getDuration();
        if (currentTime > 0 && duration > 0) void executeSync(currentTime, duration);
      }, intervalMs);
    },
    [intervalMs, executeSync],
  );

  const stopSyncTimer = useCallback(() => {
    if (syncTimerRef.current) {
      clearInterval(syncTimerRef.current);
      syncTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onReconnect = (): void => {
      void flushOfflineQueue().catch(() => undefined);
    };
    window.addEventListener('online', onReconnect);
    return () => {
      stopSyncTimer();
      window.removeEventListener('online', onReconnect);
    };
  }, [stopSyncTimer]);

  return { startSyncTimer, stopSyncTimer, executeSync };
}

export default useVideoProgressSync;
