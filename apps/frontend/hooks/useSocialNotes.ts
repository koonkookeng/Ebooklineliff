// SSOT Phase 095 BDD-1 — Social notes hook (5-state + IDB offline fallback)
// Canonical: apps/frontend/hooks/useSocialNotes.ts
// - LIFF_INIT warm -> page fetch (edge-cached) -> IDLE pins; ERROR falls
//   back to IndexedDB-cached private notes (ERROR state per §2.2 still
//   surfaces local mode). Zero-dep beyond the social client.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { socialApi, type PageNote, type SocialReadingStatus } from '../lib/social/social-client';

const IDB_DB = 'social-notes-cache';
const IDB_STORE = 'pages';

function idbOpen(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet(key: string): Promise<PageNote[] | null> {
  const db = await idbOpen();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as PageNote[] | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet(key: string, notes: PageNote[]): Promise<void> {
  const db = await idbOpen();
  if (!db) return;
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(notes.slice(0, 100), key);
  } catch {
    /* cache unavailable — non-fatal */
  }
}

export function useSocialNotes(ebookId: string | null, pageNumber: number) {
  const [status, setStatus] = useState<SocialReadingStatus>('LIFF_INIT');
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<PageNote[]>([]);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    if (!ebookId) {
      setStatus('ERROR');
      setError('ลิงก์หนังสือไม่ถูกต้อง');
      return;
    }
    setStatus('LOADING');
    setError(null);
    const key = `${ebookId}:${pageNumber}`;
    try {
      const rows = await socialApi().page(ebookId, pageNumber);
      setNotes(rows.slice(0, 100));
      setStatus(rows.length > 0 ? 'SUCCESS' : 'IDLE');
      void idbSet(key, rows);
    } catch (e) {
      const cached = await idbGet(key);
      if (cached) {
        setNotes(cached);
        setStatus('ERROR');
        setError('ออฟไลน์: แสดงโน้ตที่แคชไว้');
      } else {
        setStatus('ERROR');
        setError((e as Error).message);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ebookId, pageNumber, nonce]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  return { status, error, notes, reload: () => setNonce((n) => n + 1), setNotes };
}
