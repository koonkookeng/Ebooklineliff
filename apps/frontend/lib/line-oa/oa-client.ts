// SSOT Phase 034 §2.1/Task 6 — OA edge client (config + sync + offline cache)
// Canonical: apps/frontend/lib/line-oa/oa-client.ts
// (legacy src/frontend/lib/line-oa/oa-client.ts)
// - fetchOaConfig: public per-tenant OA config (basicId + prompt mode).
// - fetchFriendship/syncFriendship: JWT-cookie authed server truth.
// - Offline-first (§2.1): isOAFriend mirrors to localStorage (24h TTL) so the
//   login UI decides instantly; the server remains the source of truth.
// - Zero new deps.
import {
  LineOAPublicConfigSchema,
  OA_FRIEND_CACHE_TTL_MS,
  oaAddFriendUrl,
  oaFriendCacheKey,
  oaQrImageUrl,
  type LineOAPublicConfig,
} from '@repo/shared';

export { oaAddFriendUrl, oaQrImageUrl };

export async function fetchOaConfig(tenant: string): Promise<LineOAPublicConfig | null> {
  try {
    const res = await fetch(`/api/v1/line-oa/config?tenant=${encodeURIComponent(tenant)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const parsed = LineOAPublicConfigSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function fetchFriendship(lineUserId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`/api/v1/line-oa/friendship?lineUserId=${encodeURIComponent(lineUserId)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { isOAFriend?: unknown };
    return typeof data.isOAFriend === 'boolean' ? data.isOAFriend : null;
  } catch {
    return null;
  }
}

export async function syncFriendship(lineUserId: string, isOAFriend: boolean): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/line-oa/friendship/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineUserId, isOAFriend }),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface CachedFriend {
  isFriend: boolean;
  at: number;
}

export function readFriendCache(tenant: string): boolean | null {
  try {
    const raw = localStorage.getItem(oaFriendCacheKey(tenant));
    if (!raw) return null;
    const row = JSON.parse(raw) as CachedFriend;
    if (Date.now() - row.at > OA_FRIEND_CACHE_TTL_MS) return null;
    return row.isFriend;
  } catch {
    return null;
  }
}

export function writeFriendCache(tenant: string, isFriend: boolean): void {
  try {
    localStorage.setItem(oaFriendCacheKey(tenant), JSON.stringify({ isFriend, at: Date.now() } satisfies CachedFriend));
  } catch {
    // Private mode: server truth still applies this session.
  }
}
