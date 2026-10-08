// SSOT Phase 065 Task 4 — Lesson note client (REST transport + offline outbox)
// Canonical: apps/frontend/lib/video/note-client.ts
// (legacy src/frontend/lib/video/note-client.ts)
// - CRUD/search/summary/export ride Next proxies (/api/v1/notes/*).
// - Offline (BDD-3): creates/updates queue into the shared
//   AhongOfflineOmniCacheDB pendingSyncRecords store (type LESSON_NOTE,
//   zero migration) and drain via POST /api/v1/notes/sync (LWW server).
// - Zero new deps.
import type { LessonNote, LessonNoteConnection, AiNoteSummary } from '@repo/shared';
import { OFFLINE_STORES, openOfflineDb } from '../offline/indexeddb-schema';

async function asJson(res: Response, what: string): Promise<unknown> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message ?? `${what} failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface OfflineNoteItem {
  id: string;
  lessonId: string;
  timestampSec: number;
  content: string;
  tags?: string[];
  updatedAt: string;
}

export function fetchLessonNotes(lessonId: string): Promise<LessonNote[]> {
  return fetch(`/api/v1/notes?lessonId=${encodeURIComponent(lessonId)}`).then(
    (res) => asJson(res, 'Load lesson notes') as Promise<LessonNote[]>,
  );
}

export function createLessonNote(input: { lessonId: string; timestampSec: number; content: string; tags?: string[]; visibility?: string }): Promise<LessonNote> {
  return fetch('/api/v1/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((res) => asJson(res, 'Save note') as Promise<LessonNote>);
}

export function updateLessonNote(input: { noteId: string; content: string; tags?: string[]; visibility?: string }): Promise<LessonNote> {
  return fetch('/api/v1/notes', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((res) => asJson(res, 'Update note') as Promise<LessonNote>);
}

export function deleteLessonNote(noteId: string): Promise<{ deleted: boolean }> {
  return fetch(`/api/v1/notes?noteId=${encodeURIComponent(noteId)}`, { method: 'DELETE' }).then(
    (res) => asJson(res, 'Delete note') as Promise<{ deleted: boolean }>,
  );
}

export function searchMyNotes(filter: Record<string, unknown>): Promise<LessonNoteConnection> {
  return fetch('/api/v1/notes/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filter }),
  }).then((res) => asJson(res, 'Search notes') as Promise<LessonNoteConnection>);
}

export function fetchAiSummary(lessonId: string): Promise<AiNoteSummary> {
  return fetch(`/api/v1/notes/summary?lessonId=${encodeURIComponent(lessonId)}`).then(
    (res) => asJson(res, 'Summarize notes') as Promise<AiNoteSummary>,
  );
}

export function exportNotesPdf(lessonId: string): Promise<{ url: string }> {
  return fetch('/api/v1/notes/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lessonId }),
  }).then((res) => asJson(res, 'Export notes') as Promise<{ url: string }>);
}

/** Queue a note for background sync (offline-first, BDD-3). */
export async function queueOfflineNote(item: Omit<OfflineNoteItem, 'id' | 'updatedAt'> & { id?: string }): Promise<string> {
  const id = item.id ?? newId();
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      try {
        const t = db.transaction(OFFLINE_STORES.pendingSyncRecords, 'readwrite');
        t.objectStore(OFFLINE_STORES.pendingSyncRecords).put({
          id: `note:${id}`,
          type: 'LESSON_NOTE',
          targetId: item.lessonId,
          payload: { ...item, id, updatedAt: new Date().toISOString() },
          createdAt: Date.now(),
        });
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error ?? new Error('note queue failed'));
      } catch (e) {
        reject(e instanceof Error ? e : new Error('note queue failed'));
      }
    });
  } catch {
    // queue best-effort
  }
  try {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      const sync = (reg as unknown as { sync?: { register: (tag: string) => Promise<void> } }).sync;
      await sync?.register('sync-lesson-note').catch(() => undefined);
    }
  } catch {
    // sync registration best-effort; online event covers the drain
  }
  return id;
}

/** Drain queued notes on reconnect (online event + SW sync tag). */
export async function flushOfflineNotes(): Promise<{ flushed: number }> {
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return { flushed: 0 };
    const db = await openOfflineDb();
    const rows = await new Promise<Array<{ id: string; payload: unknown }>>((resolve) => {
      try {
        const t = db.transaction(OFFLINE_STORES.pendingSyncRecords, 'readonly');
        const req = t.objectStore(OFFLINE_STORES.pendingSyncRecords).getAll();
        req.onsuccess = () => resolve(((req.result as Array<{ id: string; type: string; payload: unknown }>) ?? []).filter((r) => r.id.startsWith('note:')).map((r) => ({ id: r.id, payload: r.payload })));
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    if (rows.length === 0) return { flushed: 0 };
    const res = await fetch('/api/v1/notes/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: rows.map((r) => r.payload) }),
    });
    if (!res.ok) return { flushed: 0 };
    const data = (await res.json().catch(() => null)) as { synced?: number; syncedIds?: string[] } | null;
    const acked = new Set(Array.isArray(data?.syncedIds) ? data.syncedIds : []);
    const flushed = acked.size > 0 ? acked.size : 0;
    if (flushed > 0) {
      await new Promise<void>((resolve) => {
        try {
          const t = db.transaction(OFFLINE_STORES.pendingSyncRecords, 'readwrite');
          const store = t.objectStore(OFFLINE_STORES.pendingSyncRecords);
          for (const r of rows) {
            if (acked.has(r.id)) store.delete(r.id);
          }
          t.oncomplete = () => resolve();
          t.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
    return { flushed };
  } catch {
    return { flushed: 0 };
  }
}
