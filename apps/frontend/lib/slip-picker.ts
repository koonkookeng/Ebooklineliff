// SSOT Phase 016 §2.1/§7.1 — Picker support: analytics emit + offline order cache + LIFF choose
// Canonical: apps/frontend/lib/slip-picker.ts
// - Analytics are best-effort (never block the payment flow).
// - Order-status cache is a tiny IndexedDB kv (spec OFFLINE_FIRST) with
//   graceful null when IndexedDB is unavailable (SSR/Node/tests).
// - LIFF native choose uses dynamic import + capability detection (no static
//   @line/liff dep); null means "use the file-input fallback".
import type { SlipPickerAnalyticsEvent, SlipPickerSource } from '@repo/shared';

export type { SlipPickerSource };

export async function emitSlipPickerAnalytics(
  event: Omit<SlipPickerAnalyticsEvent, 'at'>,
): Promise<void> {
  try {
    await fetch('/api/v1/payment/slip-analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch {
    // best-effort: analytics must never break checkout
  }
}

interface CachedOrderStatus {
  orderId: string;
  orderStatus: string;
  paymentStatus: string;
  netAmount: number;
  cachedAt: string;
}

const DB_NAME = 'ebook-liff';
const STORE_NAME = 'order-status';

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME, { keyPath: 'orderId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Best-effort write of the last-known order status (offline fallback). */
export async function writeCachedOrderStatus(row: Omit<CachedOrderStatus, 'cachedAt'>): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ ...row, cachedAt: new Date().toISOString() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** Last-known order status, or null when never cached / unavailable. */
export async function readCachedOrderStatus(orderId: string): Promise<CachedOrderStatus | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(orderId);
      req.onsuccess = () => resolve((req.result as CachedOrderStatus | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Attempts LINE native photo selection. Returns files on success, or null
 * when native pick is unavailable/restricted (caller shows file input).
 * The spec's liff.chooseImage exists on LINE Mini App hosts; standard LIFF
 * webviews fall through to the fallback (same as the spec's own logic).
 */
export async function tryLiffChooseImage(): Promise<File[] | null> {
  try {
    const mod = (await import('@line/liff').catch(() => null)) as unknown as {
      default?: unknown;
    } | null;
    const liff = (mod?.default ?? mod) as unknown as {
      isInClient?: () => boolean;
      chooseImage?: () => Promise<Array<{ blob?: Blob; url?: string }>>;
    } | null;
    if (!liff || typeof liff.isInClient !== 'function' || !liff.isInClient()) return null;
    if (typeof liff.chooseImage !== 'function') return null;
    const picked = await liff.chooseImage();
    const files: File[] = [];
    for (const [i, item] of picked.entries()) {
      if (item.blob instanceof Blob) {
        files.push(new File([item.blob], `liff-slip-${Date.now()}-${i}.jpg`, { type: item.blob.type || 'image/jpeg' }));
      } else if (item.url) {
        const res = await fetch(item.url).catch(() => null);
        if (res?.ok) {
          const blob = await res.blob().catch(() => null);
          if (blob) files.push(new File([blob], `liff-slip-${Date.now()}-${i}.jpg`, { type: blob.type || 'image/jpeg' }));
        }
      }
    }
    return files.length > 0 ? files : null;
  } catch {
    return null;
  }
}
