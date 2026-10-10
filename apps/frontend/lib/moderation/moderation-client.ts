// SSOT Phase 112 §2 — moderation client (REST transport + IDB offline cache)
// Canonical: apps/frontend/lib/moderation/moderation-client.ts
// - Appeal drafts + last-known moderation statuses cached in IndexedDB
//   (OFFLINE_FIRST §2.1); mutations always online. RAM-light: JSON only,
//   no blobs (Gate 5).
// - Zero-dep (fetch + IndexedDB only).
export type ModerationUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface ModerationStatusView {
  id: string | null;
  productId: string;
  status: string;
  confidenceScore: number;
  flaggedCategories: string[];
  violatingLocations: string[];
  aiAnalysisSummary: string | null;
  scannedAt: string | null;
}

export interface ModerationQueueView {
  items: ModerationStatusView[];
  totalCount: number;
  quarantinedCount: number;
  appealPendingCount: number;
}

export interface AppealSubmitResult {
  appealId: string;
  productId: string;
  status: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`moderation ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

const DB_NAME = 'zene-moderation';
const STORE = 'appeal-cache';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Offline cache is best-effort — never breaks the UI.
  }
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await idb();
    const out = await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(key);
      rq.onsuccess = () => resolve((rq.result as T | undefined) ?? null);
      rq.onerror = () => resolve(null);
    });
    db.close();
    return out;
  } catch {
    return null;
  }
}

export function moderationApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    status: async (productId: string) => {
      try {
        const live = await json<ModerationStatusView>(`/api/v1/moderation/status?${qs}&productId=${encodeURIComponent(productId)}`);
        void idbPut(`status:${productId}`, live);
        return live;
      } catch (err) {
        const cached = await idbGet<ModerationStatusView>(`status:${productId}`);
        if (cached) return cached;
        throw err;
      }
    },
    rescan: (productId: string) => post(`/api/v1/moderation/rescan?${qs}`, { productId }),
    submitAppeal: (body: { productId: string; appealReason: string; proofDocumentUrls: string[] }) =>
      post(`/api/v1/moderation/appeals/submit?${qs}`, body) as Promise<AppealSubmitResult>,
    queue: (params?: { status?: string; page?: number; limit?: number }) => {
      const q = new URLSearchParams({ tenant: slug });
      if (params?.status) q.set('status', params.status);
      q.set('page', String(params?.page ?? 1));
      q.set('limit', String(params?.limit ?? 20));
      return json<ModerationQueueView>(`/api/v1/admin/moderation/queue?${q.toString()}`);
    },
    review: (body: { productId: string; approve: boolean; adminNotes: string }) =>
      post(`/api/v1/admin/moderation/review?${qs}`, body) as Promise<boolean>,
  };
}

/** Persist an appeal draft offline (flush on reconnect via submitAppeal). */
export function saveAppealDraft(productId: string, draft: { appealReason: string; proofDocumentUrls: string[] }): Promise<void> {
  return idbPut(`draft:${productId}`, { ...draft, savedAt: Date.now() });
}

export function loadAppealDraft(productId: string): Promise<{ appealReason: string; proofDocumentUrls: string[]; savedAt: number } | null> {
  return idbGet(`draft:${productId}`);
}
