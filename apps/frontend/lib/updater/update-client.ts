// SSOT Phase 033 §6.1/§10 — Update edge client (check + purge + loop guard)
// Canonical: apps/frontend/lib/updater/update-client.ts
// (legacy src/frontend/lib/updater/update-client.ts)
// - checkForUpdate: POST /api/v1/version/check (public, no-cache); null on any
//   failure (ERROR fallback: caller continues on the local version, §2.2).
// - purgeServiceWorkers/clearAllCaches: best-effort, settled individually so one
//   stuck registration never blocks the reload path.
// - Loop guard (§10): sessionStorage counter caps consecutive auto-reloads at 2.
// - cacheBustedReload: appends ?_v=<hash> (fresh HTML shell, hashed assets stay
//   immutable-cached, §8.1).
// - <3KB gzipped equivalent: fetch + SW + storage only. Zero new deps.
import {
  UPDATE_LOOP_KEY,
  UPDATE_LOOP_MAX,
  VersionCheckResponseSchema,
  type VersionCheckResponse,
  type VersionPlatform,
} from '@repo/shared';

export interface VersionCheckInput {
  tenantId: string;
  clientVersion: string;
  clientBuildHash: string;
  platform: VersionPlatform;
}

export async function checkForUpdate(input: VersionCheckInput): Promise<VersionCheckResponse | null> {
  try {
    const res = await fetch('/api/v1/version/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const parsed = VersionCheckResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

/** Consecutive auto-reload count (loop guard, §10). */
export function updateLoopCount(): number {
  const count = Number(storage()?.getItem(UPDATE_LOOP_KEY) ?? '0');
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/** True when another auto-reload is still allowed (≤2 consecutive). */
export function canAutoReload(): boolean {
  return updateLoopCount() < UPDATE_LOOP_MAX;
}

export function recordAutoReload(): void {
  try {
    storage()?.setItem(UPDATE_LOOP_KEY, String(updateLoopCount() + 1));
  } catch {
    // Storage blocked: loop guard degrades to allow (single attempt per mount).
  }
}

export function resetAutoReload(): void {
  try {
    storage()?.removeItem(UPDATE_LOOP_KEY);
  } catch {
    // ignore
  }
}

export async function purgeServiceWorkers(): Promise<number> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 0;
    const regs = await navigator.serviceWorker.getRegistrations();
    const results = await Promise.allSettled(regs.map((r) => r.unregister()));
    return results.filter((r) => r.status === 'fulfilled' && r.value).length;
  } catch {
    return 0;
  }
}

export async function clearAllCaches(): Promise<number> {
  try {
    if (typeof caches === 'undefined') return 0;
    const names = await caches.keys();
    const results = await Promise.allSettled(names.map((n) => caches.delete(n)));
    return results.filter((r) => r.status === 'fulfilled' && r.value).length;
  } catch {
    return 0;
  }
}

/** Build the cache-busted reload URL (pure, unit-tested). */
export function cacheBustedUrl(href: string, buildHash: string): string {
  const url = new URL(href);
  url.searchParams.set('_v', buildHash);
  return url.toString();
}
