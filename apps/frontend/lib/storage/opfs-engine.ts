// SSOT Phase 068 Task 3 — OPFS engine + IndexedDB fallback (§6.1/§2.2)
// Canonical: apps/frontend/lib/storage/opfs-engine.ts
// (legacy src/frontend/lib/storage/opfs-engine.ts)
// - Primary: Origin Private File System (large blobs, streaming writes).
// - Fallback: dedicated `zene-downloads` IDB (legacy devices without OPFS).
// - Chunked appends (≤2MB writes) keep RAM <30MB; integrity via SHA-256.
// - Zero new deps.
import { DOWNLOAD_CHUNK_BYTES } from '@repo/shared';

const IDB_NAME = 'zene-downloads';
const IDB_STORE = 'blobs';

function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return Promise.resolve(null);
    return navigator.storage.getDirectory().catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

function openBlobsDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPut(fileName: string, data: ArrayBuffer, append: boolean): Promise<void> {
  const db = await openBlobsDb();
  if (!db) throw new Error('fallback storage unavailable');
  try {
    const prev = await new Promise<ArrayBuffer | null>((resolve) => {
      try {
        const t = db.transaction(IDB_STORE, 'readonly');
        const r = t.objectStore(IDB_STORE).get(fileName);
        r.onsuccess = () => resolve((r.result as ArrayBuffer | undefined) ?? null);
        r.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    const merged = append && prev ? concatBuffers(prev, data) : data.slice(0);
    await new Promise<void>((resolve, reject) => {
      try {
        const t = db.transaction(IDB_STORE, 'readwrite');
        t.objectStore(IDB_STORE).put(merged, fileName);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error ?? new Error('idb put failed'));
      } catch (e) {
        reject(e instanceof Error ? e : new Error('idb put failed'));
      }
    });
  } finally {
    db.close();
  }
}

function concatBuffers(a: ArrayBuffer, b: ArrayBuffer): ArrayBuffer {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(new Uint8Array(a), 0);
  out.set(new Uint8Array(b), a.byteLength);
  return out.buffer;
}

export type StorageLocation = 'OPFS' | 'INDEXED_DB';

export class OpfsStorageEngine {
  private location: StorageLocation | null = null;

  /** Probe once; caches OPFS vs fallback decision. */
  async locationKind(): Promise<StorageLocation> {
    if (this.location) return this.location;
    const root = await opfsRoot();
    this.location = root ? 'OPFS' : 'INDEXED_DB';
    return this.location;
  }

  async appendChunk(fileName: string, chunk: ArrayBuffer): Promise<StorageLocation> {
    if (chunk.byteLength > DOWNLOAD_CHUNK_BYTES * 2) throw new Error('chunk exceeds 2MB budget');
    const root = await opfsRoot();
    if (root) {
      const handle = await root.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable({ keepExistingData: true });
      try {
        const existing = await handle.getFile().catch(() => null);
        await writable.write({ type: 'write', position: existing?.size ?? 0, data: chunk });
      } finally {
        await writable.close().catch(() => undefined);
      }
      return 'OPFS';
    }
    await idbPut(fileName, chunk, true);
    return 'INDEXED_DB';
  }

  async readFile(fileName: string): Promise<ArrayBuffer | null> {
    const root = await opfsRoot();
    if (root) {
      try {
        const file = await (await root.getFileHandle(fileName)).getFile();
        return await file.arrayBuffer();
      } catch {
        return null;
      }
    }
    const db = await openBlobsDb();
    if (!db) return null;
    try {
      return await new Promise<ArrayBuffer | null>((resolve) => {
        try {
          const t = db.transaction(IDB_STORE, 'readonly');
          const r = t.objectStore(IDB_STORE).get(fileName);
          r.onsuccess = () => resolve((r.result as ArrayBuffer | undefined) ?? null);
          r.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    } finally {
      db.close();
    }
  }

  async deleteFile(fileName: string): Promise<void> {
    const root = await opfsRoot();
    if (root) {
      await root.removeEntry(fileName).catch(() => undefined);
      return;
    }
    const db = await openBlobsDb();
    if (!db) return;
    try {
      await new Promise<void>((resolve) => {
        try {
          const t = db.transaction(IDB_STORE, 'readwrite');
          t.objectStore(IDB_STORE).delete(fileName);
          t.oncomplete = () => resolve();
          t.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    } finally {
      db.close();
    }
  }

  async sha256Hex(data: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}
