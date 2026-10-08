// SSOT Phase 083 §2.1 — Gamification client (REST transport + IDB cache)
// Canonical: apps/frontend/lib/gamification/gamification-client.ts
// - Catalog/badges cached offline-first (§2.1); mutations always online.
// - Zero-dep (fetch + IndexedDB only).
export type GameStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface GamificationProfile {
  currentStreak: number;
  longestStreak: number;
  lastCheckinDate: string | null;
  streakFreezeCount: number;
  hasCheckedInToday: boolean;
  rewardPoints: number;
  unlockedBadgesCount: number;
}

export interface GameBadge {
  id: string;
  code: string;
  name: string;
  description: string;
  iconUrl: string;
  category: string;
  pointsReward: number;
  isUnlocked: boolean;
  unlockedAt: string | null;
}

export interface RewardCatalogItem {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  rewardType: string;
  pointsRequired: number;
  stockQty: number;
  isPublished: boolean;
  isAvailable: boolean;
}

export interface CheckinResult {
  success: boolean;
  message: string;
  currentStreak: number;
  pointsEarned: number;
  bonusMultiplier: number;
  nextMilestoneDays: number;
  badgeUnlocked: { badgeId: string; badgeName: string; iconUrl: string } | null;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`gamification ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function gameApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body?: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return {
    profile: () => json<GamificationProfile>(`/api/v1/gamification/profile?${qs}`),
    badges: () => json<GameBadge[]>(`/api/v1/gamification/badges?${qs}`),
    catalog: () => json<RewardCatalogItem[]>(`/api/v1/gamification/catalog?${qs}`),
    checkin: () => post(`/api/v1/gamification/checkin?${qs}`) as Promise<CheckinResult>,
    redeem: (body: unknown) =>
      post(`/api/v1/gamification/redeem?${qs}`, body) as Promise<{
        success: boolean; redemptionCode: string; remainingPoints: number; entitlementGranted: boolean;
      }>,
    buyFreeze: () => post(`/api/v1/gamification/freeze/buy?${qs}`) as Promise<GamificationProfile>,
  };
}

const DB = 'game-hub-db';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('catalog');
      req.result.createObjectStore('badges');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Best-effort cache.
  }
}

async function idbGet<T>(store: string, key: string): Promise<T | null> {
  try {
    const db = await idb();
    const out = await new Promise<T | null>((resolve) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
    db.close();
    return out;
  } catch {
    return null;
  }
}

/** Offline-first catalog snapshot (§2.1). */
export function cacheCatalog(slug: string, items: RewardCatalogItem[]): Promise<void> {
  return idbPut('catalog', slug, items);
}

export function cachedCatalog<T extends RewardCatalogItem[]>(slug: string): Promise<T | null> {
  return idbGet<T>('catalog', slug);
}

/** Offline-first badge gallery snapshot (§2.1). */
export function cacheBadges(slug: string, badges: GameBadge[]): Promise<void> {
  return idbPut('badges', slug, badges);
}

export function cachedBadges<T extends GameBadge[]>(slug: string): Promise<T | null> {
  return idbGet<T>('badges', slug);
}
