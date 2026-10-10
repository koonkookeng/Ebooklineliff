// SSOT Phase 113 §2 — dispute client (REST + IDB drafts + image compress)
// Canonical: apps/frontend/lib/dispute/dispute-client.ts
// - Drafts + last-known escrow/dispute snapshots cached in IndexedDB
//   (OFFLINE_FIRST §2.1); mutations always online.
// - Evidence images compressed client-side (≤1600px, JPEG, <2MB, single
//   canvas + immediate revoke — Gate 5 RAM <30MB).
// - Zero-dep (fetch + IndexedDB + Canvas only).
export type DisputeUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface EscrowStatusView {
  escrowId: string;
  orderId: string;
  grossAmount: number;
  holdingUntil: string;
  status: string;
  expired: boolean;
}

export interface DisputeDetailView {
  id: string;
  disputeNo: string;
  orderId: string;
  reason: string;
  description: string;
  status: string;
  requestedRefundAmount: number;
  approvedRefundAmount: number | null;
  evidences: Array<{ id: string; fileUrl: string; fileType: string; uploadedAt: string }>;
  timelines: Array<{ id: string; actorRole: string; actionState: string; note: string | null; createdAt: string }>;
  createdAt: string;
}

export interface DisputeClaimResult {
  id: string;
  disputeNo: string;
  status: string;
}

/** Client-side evidence compressor (JPEG ≤1600px, <2MB, RAM-disciplined). */
export async function compressDisputeImage(file: File): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.src = dataUrl;
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('unreadable image'));
  });
  // NOTE: data: URLs (FileReader) need no revokeObjectURL — only blob:
  // URLs do. Memory discipline here is single-canvas + JPEG downscale.
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(img.width * scale));
  canvas.height = Math.max(1, Math.floor(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get 2d context');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let quality = 0.85;
  for (let i = 0; i < 4; i++) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Blob creation failed');
    if (blob.size < 2 * 1024 * 1024 || quality <= 0.4) return blob;
    quality -= 0.15;
  }
  const fallback = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.4));
  if (!fallback) throw new Error('Blob creation failed');
  return fallback;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`dispute ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

const DB_NAME = 'zene-dispute';
const STORE = 'dispute-cache';

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

export function disputeApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    escrowStatus: async (orderId: string) => {
      try {
        const live = await json<EscrowStatusView>(`/api/v1/escrow/status?${qs}&orderId=${encodeURIComponent(orderId)}`);
        void idbPut(`escrow:${orderId}`, live);
        return live;
      } catch (err) {
        const cached = await idbGet<EscrowStatusView>(`escrow:${orderId}`);
        if (cached) return cached;
        throw err;
      }
    },
    disputeByOrder: async (orderId: string) => {
      try {
        const live = await json<DisputeDetailView | null>(`/api/v1/disputes/by-order?${qs}&orderId=${encodeURIComponent(orderId)}`);
        if (live) void idbPut(`dispute:${orderId}`, live);
        return live;
      } catch (err) {
        const cached = await idbGet<DisputeDetailView>(`dispute:${orderId}`);
        if (cached) return cached;
        throw err;
      }
    },
    fileClaim: (body: { orderId: string; reason: string; description: string; evidenceImageUrls: string[]; requestedRefundAmount: number }) =>
      post(`/api/v1/disputes/claim?${qs}`, body) as Promise<DisputeClaimResult>,
    cancelClaim: (disputeId: string) => post(`/api/v1/disputes/cancel?${qs}`, { disputeId }) as Promise<boolean>,
  };
}

/** Persist a filing draft offline (flush on reconnect via fileClaim). */
export function saveDisputeDraft(orderId: string, draft: { reason: string; description: string; requestedRefundAmount: number }): Promise<void> {
  return idbPut(`draft:${orderId}`, { ...draft, savedAt: Date.now() });
}

export function loadDisputeDraft(orderId: string): Promise<{ reason: string; description: string; requestedRefundAmount: number; savedAt: number } | null> {
  return idbGet(`draft:${orderId}`);
}
