// SSOT Phase 068 Task 4/7 — Download orchestrator (worker + OPFS + license)
// Canonical: apps/frontend/lib/download/download-manager.ts
// - startDownload: license issue → worker START → CHUNK append (OPFS/IDB) →
//   COMPLETE (integrity hash, quota report, analytics event).
// - pause/resume/cancel/remove; license re-check before render (EXPIRED →
//   LRU purge suggestion); storage-warning via navigator.estimate.
// - Analytics: pulse POST when online, else `zene-download-events` IDB
//   (own drain — never touches the 052 telemetry queue).
// - Zero new deps.
import { downloadProgress, isStorageLow, type StorageCategory } from '@repo/shared';
import { downloadStore } from '../../stores/use-download-store';
import { OpfsStorageEngine } from '../storage/opfs-engine';
import { licenseIntegrityHash } from '../crypto/offline-drm';

const EVENTS_DB = 'zene-download-events';
const EVENTS_STORE = 'events';

const engine = new OpfsStorageEngine();
let worker: Worker | null = null;
let activeProduct: string | null = null;

function deviceIdHash(): string {
  try {
    const raw = `${navigator.userAgent}|${screen.width}x${screen.height}|${navigator.language}`;
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (Math.imul(h, 31) + raw.charCodeAt(i)) | 0;
    return `dev-${(h >>> 0).toString(16)}`;
  } catch {
    return 'dev-unknown';
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as { message?: string } | null)?.message ?? `request failed (${res.status})`);
  return data as T;
}

export function issueOfflineLicense(productId: string) {
  return api<{ licenseToken: string; signature: string; encryptionKeyCipher: string; validUntil: string; contentKey: string }>(
    '/api/v1/offline-license/issue',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId, deviceIdHash: deviceIdHash() }) },
  );
}

export function checkLicenseStatus(productId: string) {
  return api<{ status: 'VALID' | 'EXPIRED' | 'REVOKED' | 'MISSING'; validUntil?: string }>(
    `/api/v1/offline-license/status?productId=${encodeURIComponent(productId)}&deviceIdHash=${encodeURIComponent(deviceIdHash())}`,
  );
}

async function openEventsDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(EVENTS_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(EVENTS_STORE)) req.result.createObjectStore(EVENTS_STORE, { autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Best-effort analytics (Task 7): pulse now, or queue for the online drain. */
export async function reportDownloadEvent(event: string, productId: string, extra: Record<string, unknown> = {}): Promise<void> {
  const body = { event, productId, device: 'LIFF', ...extra, at: new Date().toISOString() };
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('offline');
    await fetch('/api/v1/analytics/pulse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [body] }),
    });
  } catch {
    const db = await openEventsDb();
    if (!db) return;
    try {
      const t = db.transaction(EVENTS_STORE, 'readwrite');
      t.objectStore(EVENTS_STORE).add({ body, ts: Date.now() });
    } catch {
      // analytics only
    } finally {
      db.close();
    }
  }
}

export async function drainDownloadEvents(): Promise<void> {
  const db = await openEventsDb();
  if (!db) return;
  try {
    const rows: Array<{ key: IDBValidKey; body: unknown }> = await new Promise((resolve) => {
      const out: Array<{ key: IDBValidKey; body: unknown }> = [];
      try {
        const t = db.transaction(EVENTS_STORE, 'readonly');
        const c = t.objectStore(EVENTS_STORE).openCursor();
        c.onsuccess = () => {
          if (c.result) {
            out.push({ key: c.result.key, body: (c.result.value as { body: unknown }).body });
            c.result.continue();
          } else resolve(out);
        };
        c.onerror = () => resolve(out);
      } catch {
        resolve(out);
      }
    });
    for (const row of rows) {
      try {
        await fetch('/api/v1/analytics/pulse', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ events: [row.body] }),
        });
        await new Promise<void>((resolve) => {
          try {
            const t = db.transaction(EVENTS_STORE, 'readwrite');
            t.objectStore(EVENTS_STORE).delete(row.key);
            t.oncomplete = () => resolve();
            t.onerror = () => resolve();
          } catch {
            resolve();
          }
        });
      } catch {
        break;
      }
    }
  } finally {
    db.close();
  }
}

function ensureWorker(onChunk: (iv: ArrayBuffer, buffer: ArrayBuffer, downloadedBytes: number, speedBps: number) => Promise<void>, onDone: (downloadedBytes: number) => void, onError: (message: string) => void): Worker {
  if (!worker) worker = new Worker(new URL('../../workers/download-worker.ts', import.meta.url));
  // Rebind every start: a reused worker must not keep stale closures.
  const w = worker;
  w.onmessage = (e: MessageEvent) => {
    const msg = e.data as { type: string; taskId: string; message?: string; iv?: ArrayBuffer; buffer?: ArrayBuffer; downloadedBytes?: number; speedBps?: number };
    if (msg.taskId !== activeProduct) return;
    if (msg.type === 'CHUNK' && msg.iv && msg.buffer) {
      void onChunk(msg.iv, msg.buffer, msg.downloadedBytes ?? 0, msg.speedBps ?? 0);
    } else if (msg.type === 'COMPLETE') {
      onDone(msg.downloadedBytes ?? 0);
    } else if (msg.type === 'ERROR') {
      onError(msg.message ?? 'download failed');
    }
  };
  return w;
}

export interface StartDownloadInput {
  productId: string;
  title: string;
  category: StorageCategory;
  fileUrl: string;
  totalBytes: number;
}

export async function startDownload(input: StartDownloadInput): Promise<void> {
  const { productId } = input;
  if (activeProduct === productId) return; // already streaming chunks
  downloadStore.upsertTask(productId, { title: input.title, category: input.category, totalBytes: input.totalBytes, status: 'QUEUED' });
  downloadStore.setUiState('DOWNLOAD_QUEUED_PROGRESS');

  // Storage guard (§2.2 STORAGE_WARNING).
  try {
    const est = await navigator.storage?.estimate?.();
    const quota = est?.quota ?? 0;
    const usage = est?.usage ?? 0;
    downloadStore.setQuota(quota, usage);
    if (isStorageLow(usage, quota)) {
      downloadStore.setUiState('STORAGE_WARNING', 'พื้นที่ใกล้เต็ม — ลบไฟล์เก่าที่ไม่ใช้แล้ว');
      return;
    }
  } catch {
    // estimate best-effort
  }

  // License gate (EXPIRED → overlay state, no bytes fetched).
  let license: { licenseToken: string; contentKey: string; validUntil: string };
  try {
    license = await issueOfflineLicense(productId);
  } catch (e) {
    downloadStore.upsertTask(productId, { status: 'FAILED' });
    downloadStore.setUiState('LICENSE_EXPIRED_ERROR', e instanceof Error ? e.message : 'ขอสิทธิ์ออฟไลน์ล้มเหลว');
    return;
  }

  const fileName = `dl-${productId}.bin`;
  const prior = downloadStore.getState().tasks[productId];
  const fromByte = prior?.downloadedBytes ?? 0;
  activeProduct = productId;

  const onChunk = async function (iv: ArrayBuffer, buffer: ArrayBuffer, downloadedBytes: number, speedBps: number): Promise<void> {
    try {
      await engine.appendChunk(fileName, buffer);
      const total = downloadStore.getState().tasks[productId]?.totalBytes ?? input.totalBytes;
      const etaSec = speedBps > 0 ? Math.max(0, Math.round((total - downloadedBytes) / speedBps)) : null;
      downloadStore.upsertTask(productId, {
        downloadedBytes, progress: downloadProgress(downloadedBytes, total), speedBps, etaSec, status: 'DOWNLOADING',
      });
    } catch (e) {
      stopWorker();
      downloadStore.upsertTask(productId, { status: 'FAILED' });
      downloadStore.setUiState('DOWNLOAD_QUEUED_PROGRESS', e instanceof Error ? e.message : 'เขียนไฟล์ล้มเหลว');
    }
  };

  const onDone = async (downloadedBytes: number): Promise<void> => {
    const blob = await engine.readFile(fileName);
    const integrityHash = blob ? await engine.sha256Hex(blob) : '';
    // Persist license record device-local for offline verification.
    try {
      localStorage.setItem(
        `zene-license:${productId}`,
        JSON.stringify({
          licenseToken: license.licenseToken,
          contentKeyB64: license.contentKey,
          productId,
          deviceIdHash: deviceIdHash(),
          validUntil: license.validUntil,
          integrityHash: await licenseIntegrityHash({
            licenseToken: license.licenseToken, contentKeyB64: license.contentKey,
            productId, deviceIdHash: deviceIdHash(), validUntil: license.validUntil,
          }),
        }),
      );
    } catch {
      // license cache best-effort
    }
    downloadStore.upsertTask(productId, { downloadedBytes, progress: 100, status: 'COMPLETED', licenseState: 'VALID' });
    downloadStore.setUiState('OFFLINE_READY');
    activeProduct = null;
    void reportDownloadEvent('offline_download_completed', productId, { bytes: downloadedBytes, integrityHash });
    void api('/api/v1/offline-license/quota', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceIdHash: deviceIdHash(), usedBytes: downloadedBytes }),
    }).catch(() => undefined);
  };

  const onError = (message: string): void => {
    downloadStore.upsertTask(productId, { status: 'FAILED' });
    downloadStore.setUiState('DOWNLOAD_QUEUED_PROGRESS', message);
    activeProduct = null;
    void reportDownloadEvent('offline_download_failed', productId, { message });
  };

  ensureWorker(onChunk, (n) => void onDone(n), onError).postMessage({
    command: fromByte > 0 ? 'RESUME' : 'START',
    taskId: productId,
    url: input.fileUrl,
    fromByte,
    totalBytes: input.totalBytes,
    contentKeyB64: license.contentKey,
  });
}

export function pauseDownload(productId: string): void {
  try {
    worker?.postMessage({ command: 'PAUSE', taskId: productId });
  } catch {
    // worker best-effort
  }
  if (activeProduct === productId) activeProduct = null;
  downloadStore.upsertTask(productId, { status: 'PAUSED' });
}

export function cancelDownload(productId: string): void {
  stopWorker();
  downloadStore.removeTask(productId);
}

export async function removeDownload(productId: string): Promise<void> {
  stopWorker();
  await engine.deleteFile(`dl-${productId}.bin`);
  try {
    localStorage.removeItem(`zene-license:${productId}`);
  } catch {
    // cache best-effort
  }
  downloadStore.removeTask(productId);
  void reportDownloadEvent('offline_download_removed', productId);
}

function stopWorker(): void {
  try {
    worker?.terminate();
  } catch {
    // terminate best-effort
  }
  worker = null;
  activeProduct = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void drainDownloadEvents());
}
