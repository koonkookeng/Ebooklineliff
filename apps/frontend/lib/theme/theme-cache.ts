// SSOT Phase 030 §2.1 OFFLINE_FIRST — Tenant theme offline cache (IDB + fallback)
// Canonical: apps/frontend/lib/theme/theme-cache.ts
// (legacy src/frontend/lib/theme/theme-cache.ts)
// - IndexedDB store `liff-theme` (key = tenant slug, 24h TTL mirror of the edge);
//   falls back to localStorage, then to null (caller renders defaults, CLS = 0).
// - Pure helpers (themeCacheKey, isThemeFresh) are unit-tested; IDB wrappers are
//   best-effort and never throw (offline/private-mode safe).
// - Zero new deps. Payload < 1KB « 0.5MB Gate 5 budget.
import type { TenantBranding } from '@repo/shared';

export const THEME_DB = 'liff-theme';
export const THEME_STORE = 'themes';
export const THEME_TTL_MS = 24 * 3600 * 1000;

export function themeCacheKey(tenantSlug: string): string {
  return `theme:${tenantSlug}`;
}

export function isThemeFresh(cachedAt: number, now: number = Date.now()): boolean {
  return now - cachedAt < THEME_TTL_MS;
}

interface CachedTheme {
  branding: TenantBranding;
  cachedAt: number;
}

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(THEME_DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(THEME_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function readCachedTheme(tenantSlug: string): Promise<CachedTheme | null> {
  const key = themeCacheKey(tenantSlug);
  try {
    const db = await idb();
    if (db) {
      const row = await new Promise<CachedTheme | null>((resolve) => {
        try {
          const tx = db.transaction(THEME_STORE, 'readonly');
          const req = tx.objectStore(THEME_STORE).get(key);
          req.onsuccess = () => resolve((req.result as CachedTheme | undefined) ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
      db.close();
      if (row && isThemeFresh(row.cachedAt)) return row;
    }
  } catch {
    // fall through to localStorage
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const row = JSON.parse(raw) as CachedTheme;
    return isThemeFresh(row.cachedAt) ? row : null;
  } catch {
    return null;
  }
}

export async function writeCachedTheme(tenantSlug: string, branding: TenantBranding): Promise<void> {
  const key = themeCacheKey(tenantSlug);
  const row: CachedTheme = { branding, cachedAt: Date.now() };
  try {
    const db = await idb();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(THEME_STORE, 'readwrite');
          tx.objectStore(THEME_STORE).put(row, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
      db.close();
      return;
    }
  } catch {
    // fall through to localStorage
  }
  try {
    localStorage.setItem(key, JSON.stringify(row));
  } catch {
    // Quota/private mode: theme stays memory-only this session.
  }
}
