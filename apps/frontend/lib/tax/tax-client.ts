// SSOT Phase 082 §2.1 — Tax client (REST transport + IndexedDB annual cache)
// Canonical: apps/frontend/lib/tax/tax-client.ts
// - Annual summaries cached offline-first (§2.1 OFFLINE_FIRST); cert rows
//   stay server-side (PII minimization).
// - Zero-dep (fetch + IndexedDB only).
export type TaxStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface TaxSummary {
  year: number;
  gross: number;
  tax: number;
  count: number;
}

export interface TaxCertificateRow {
  id: string;
  certificateNo: string;
  grossAmount: number;
  taxWithheld: number;
  netAmount: number;
  paymentDate: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`tax ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function taxApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    summary: (year: number) => json<TaxSummary>(`/api/v1/tax/summary?${qs}&year=${year}`),
    certificates: (limit = 20) =>
      json<TaxCertificateRow[]>(`/api/v1/tax/certificates?${qs}&limit=${limit}`),
    calculate: (body: unknown) =>
      post(`/api/v1/tax/calculate?${qs}`, body) as Promise<{
        grossAmount: number; taxRate: number; taxWithheld: number; netAmount: number;
        isExempt: boolean; anomalies: string[];
      }>,
    generate: (body: unknown) =>
      post(`/api/v1/tax/certificates/generate?${qs}`, body) as Promise<{
        certificateId: string; certificateNo: string; downloadUrl: string;
        downloadExpiresInSec: number; pdfBytes: number; tookMs: number;
      }>,
    downloadUrl: (ticket: string) => `/api/v1/tax/download?ticket=${encodeURIComponent(ticket)}`,
  };
}

const DB = 'tax-center-db';
const STORE = 'annual-summary';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Offline-first annual summary snapshot (§2.1). */
export async function cacheTaxSummary(year: number, summary: TaxSummary): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(summary, year);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Best-effort cache.
  }
}

/** Read the cached annual summary (null when absent). */
export async function cachedTaxSummary(year: number): Promise<TaxSummary | null> {
  try {
    const db = await idb();
    const out = await new Promise<TaxSummary | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(year);
      req.onsuccess = () => resolve((req.result as TaxSummary | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
    db.close();
    return out;
  } catch {
    return null;
  }
}
