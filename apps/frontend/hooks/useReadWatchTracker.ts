'use client';
// SSOT Phase 052 §6.1 — read/watch telemetry hook (ring buffer + beacon + IDB retry)
// Canonical: apps/frontend/hooks/useReadWatchTracker.ts
// (legacy src/frontend/hooks/useReadWatchTracker.ts)
// - In-memory ring (cap 100 records, §2.1); flush every 15s + on
//   visibilitychange hidden + beforeunload + unmount (§2.2).
// - sendBeacon first (no lost pulses on app-switch); fetch fallback with
//   keepalive; failures land in a capped IndexedDB retry queue (zero new deps).
// - RAM guard: buffers clear on ACK; IDB queue caps at 200 rows then drops
//   oldest (telemetry never grows unbounded on flaky networks).
import { useCallback, useEffect, useRef } from 'react';
import {
  ANALYTICS_FLUSH_SEC,
  ANALYTICS_NIL_USER,
  ANALYTICS_RING_CAP,
} from '@repo/shared';

interface TrackerConfig {
  userId: string | null;
  productId?: string; // optional: falls back to contentId (writer resolves product)
  contentId: string; // ebookId (or productId) / lessonId
  contentType: 'READ' | 'WATCH';
}

interface BufferedRead {
  pageNumber: number;
  dwellTimeSec: number;
}
interface BufferedWatch {
  watchedSec: number;
  lastPos: number;
  durationSec: number;
}

const IDB_NAME = 'ebook-telemetry';
const IDB_STORE = 'retry-queue';
const IDB_CAP = 200;

function openIdb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE, { autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbEnqueue(payload: string): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).add({ payload, ts: Date.now() });
    // Trim oldest past cap (fail-open).
    const countReq = tx.objectStore(IDB_STORE).count();
    countReq.onsuccess = () => {
      if (countReq.result > IDB_CAP) {
        const trim = db.transaction(IDB_STORE, 'readwrite');
        const cursor = trim.objectStore(IDB_STORE).openCursor();
        let over = countReq.result - IDB_CAP;
        cursor.onsuccess = () => {
          if (over > 0 && cursor.result) {
            cursor.result.delete();
            over--;
            cursor.result.continue();
          }
        };
      }
    };
  } catch {
    // telemetry only
  } finally {
    db.close();
  }
}

async function idbDrain(send: (payload: string) => Promise<boolean>): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  try {
    const rows: Array<{ key: IDBValidKey; payload: string }> = await new Promise((resolve) => {
      const out: Array<{ key: IDBValidKey; payload: string }> = [];
      const tx = db.transaction(IDB_STORE, 'readonly');
      const cursor = tx.objectStore(IDB_STORE).openCursor();
      cursor.onsuccess = () => {
        if (cursor.result) {
          out.push({ key: cursor.result.key, payload: (cursor.result.value as { payload: string }).payload });
          cursor.result.continue();
        } else resolve(out);
      };
      cursor.onerror = () => resolve(out);
    });
    for (const row of rows) {
      if (await send(row.payload)) {
        await new Promise<void>((resolve) => {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).delete(row.key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      } else break; // stop on first failure; retry next cycle
    }
  } catch {
    // telemetry only
  } finally {
    db.close();
  }
}

export function useReadWatchTracker({ userId, productId = '', contentId, contentType }: TrackerConfig) {
  const readBufferRef = useRef<Map<number, number>>(new Map()); // Page -> DwellSec
  const watchRef = useRef<BufferedWatch>({ watchedSec: 0, lastPos: 0, durationSec: 0 });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const identityRef = useRef(userId);
  identityRef.current = userId;

  const postPayload = useCallback(async (payload: string): Promise<boolean> => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([payload], { type: 'application/json' });
        if (navigator.sendBeacon('/api/v1/analytics/pulse', blob)) return true;
      }
      const res = await fetch('/api/v1/analytics/pulse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
        keepalive: true,
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const flushMetrics = useCallback(() => {
    if (typeof window === 'undefined') return;
    const uid = identityRef.current ?? ANALYTICS_NIL_USER; // server stamps JWT id
    // productId falls back to contentId (lesson page only knows lesson scope;
    // the batch writer resolves the real product server-side).
    const pid = productId || contentId;
    const now = new Date().toISOString();
    const readEvents = Array.from(readBufferRef.current.entries()).map(([pageNumber, dwellTimeSec]) => ({
      userId: uid,
      productId: pid,
      ebookId: contentType === 'READ' ? contentId : pid,
      pageNumber,
      dwellTimeSec,
      scrollDepthPercentage: 100,
      timestamp: now,
    }));
    const watchEvents =
      contentType === 'WATCH' && watchRef.current.watchedSec > 0
        ?           [
            {
              userId: uid,
              productId: pid,
              lessonId: contentId,
              watchedSec: watchRef.current.watchedSec,
              currentTimestampSec: watchRef.current.lastPos,
              durationSec: Math.max(1, watchRef.current.durationSec),
              playbackRate: 1.0,
              timestamp: now,
            },
          ]
        : [];
    if (readEvents.length === 0 && watchEvents.length === 0) {
      void idbDrain(postPayload);
      return;
    }
    const payload = JSON.stringify({
      tenantId: 'default',
      deviceInfo: { userAgent: navigator.userAgent, isLiff: true },
      readEvents,
      watchEvents,
    });
    void postPayload(payload).then((acked) => {
      if (acked) {
        readBufferRef.current.clear();
        watchRef.current.watchedSec = 0;
      } else {
        void idbEnqueue(payload);
      }
      void idbDrain(postPayload);
    });
  }, [productId, contentId, contentType, postPayload]);

  // Dwell accounting capped at ring size (oldest page evicted first).
  const trackPageDwell = useCallback((pageNumber: number) => {
    const buf = readBufferRef.current;
    buf.set(pageNumber, (buf.get(pageNumber) || 0) + 1);
    if (buf.size > ANALYTICS_RING_CAP) {
      const oldest = buf.keys().next();
      if (!oldest.done) buf.delete(oldest.value);
    }
  }, []);

  const trackVideoPulse = useCallback((currentPosSec: number, durationSec: number) => {
    watchRef.current.watchedSec += 5;
    watchRef.current.lastPos = Math.floor(currentPosSec);
    watchRef.current.durationSec = durationSec;
  }, []);

  useEffect(() => {
    timerRef.current = setInterval(flushMetrics, ANALYTICS_FLUSH_SEC * 1000);
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushMetrics();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('beforeunload', flushMetrics);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('beforeunload', flushMetrics);
      flushMetrics();
    };
  }, [flushMetrics]);

  return { trackPageDwell, trackVideoPulse, flushMetrics };
}

export default useReadWatchTracker;
