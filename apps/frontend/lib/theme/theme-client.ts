// SSOT Phase 066 Task 5 — Theme client (REST transport + local persistence)
// Canonical: apps/frontend/lib/theme/theme-client.ts
// (legacy src/frontend/lib/theme/theme-client.ts)
// - Instant load from localStorage (FOUT prevention, LIFF_INIT); debounced
//   server persist (800ms); offline mutations stay local and flush the
//   latest snapshot on `online` (single-row LWW — no queue needed).
// - Cross-device realtime via SSE (/api/v1/preferences/stream); cross-tab
//   via BroadcastChannel (provider-owned).
// - Zero new deps.
import type { UserReadingPreference } from '@repo/shared';

const STORAGE_KEY = 'zene-reading-preference-v1';

export function loadLocalPreference(): Partial<UserReadingPreference> | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<UserReadingPreference>;
  } catch {
    return null;
  }
}

export function saveLocalPreference(prefs: Partial<UserReadingPreference>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prefs, updatedAt: new Date().toISOString() }));
  } catch {
    // storage best-effort (private mode quota)
  }
}

async function asJson(res: Response, what: string): Promise<unknown> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message ?? `${what} failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export function fetchServerPreference(): Promise<UserReadingPreference> {
  return fetch('/api/v1/preferences').then(
    (res) => asJson(res, 'Load reading preference') as Promise<UserReadingPreference>,
  );
}

export function persistServerPreference(
  fields: Partial<UserReadingPreference> & { triggerSource?: string },
): Promise<UserReadingPreference> {
  return fetch('/api/v1/preferences', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fields),
  }).then((res) => asJson(res, 'Save reading preference') as Promise<UserReadingPreference>);
}

export function syncOfflinePreference(prefs: Partial<UserReadingPreference>): Promise<UserReadingPreference> {
  return fetch('/api/v1/preferences/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preference: { ...prefs, updatedAt: new Date().toISOString() } }),
  }).then((res) => asJson(res, 'Sync reading preference') as Promise<UserReadingPreference>);
}

/** Cross-device SSE subscription; returns an unsubscribe fn. */
export function subscribePreferenceStream(
  userId: string,
  onRemote: (prefs: UserReadingPreference) => void,
): () => void {
  try {
    const source = new EventSource(`/api/v1/preferences/stream?userId=${encodeURIComponent(userId)}`);
    source.onmessage = (e: MessageEvent) => {
      try {
        const frame = JSON.parse(e.data as string) as { data?: UserReadingPreference };
        const prefs = (frame.data ?? frame) as UserReadingPreference;
        if (prefs && typeof prefs === 'object') onRemote(prefs);
      } catch {
        // malformed frame never breaks the stream
      }
    };
    return () => source.close();
  } catch {
    return () => undefined;
  }
}

