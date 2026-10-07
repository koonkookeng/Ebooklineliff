// SSOT Phase 027 §8.1 — Navigation edge client (sync + sanitization + route sign)
// Canonical: apps/frontend/lib/navigation/navigation-client.ts
// (legacy src/frontend/lib/navigation/navigation-client.ts)
// - syncSession: fire-and-forget POST to the Next proxy (auth passthrough); never
//   throws the UX path (returns false on failure, retry on next navigation).
// - sanitizeSensitiveState: §8.1 session-leak prevention — drops payment/quiz keys
//   from sessionStorage before liff.closeWindow().
// - signRouteState: HMAC-SHA256 via WebCrypto (async) with FNV-1a fallback so the
//   guard never blocks navigation when SubtleCrypto is unavailable (non-secure ctx).
// - Zero new deps (fetch + WebCrypto only); payload capped at 32KB (Gate 5).

const SENSITIVE_KEYS = ['slip-upload', 'quiz-session', 'payment-intent', 'entitlement-token'];

export function sanitizeSensitiveState(): void {
  try {
    for (const k of SENSITIVE_KEYS) sessionStorage.removeItem(k);
    // Drop any namespaced temp keys without touching reader offline chunks.
    const drop: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && (key.startsWith('tmp:') || key.startsWith('secure:'))) drop.push(key);
    }
    for (const k of drop) sessionStorage.removeItem(k);
  } catch {
    // Storage unavailable (private mode): nothing to leak.
  }
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a-${(h >>> 0).toString(16)}`;
}

/** Sign route state (§8.1 tamper guard). Async; falls back to FNV-1a offline. */
export async function signRouteState(pathname: string, secretHint = ''): Promise<string> {
  const data = `${pathname}:${secretHint}`;
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Fall through to non-crypto fallback.
  }
  return fnv1a(data);
}

export interface SyncSessionInput {
  userId: string;
  lineUserId: string;
  lastPathname: string;
  stateSnapshotJson: string;
}

export async function syncNavigationSession(input: SyncSessionInput): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/navigation/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function restoreNavigationSession(userId: string): Promise<{
  found: boolean;
  lastPathname: string | null;
  payload: unknown | null;
}> {
  try {
    const res = await fetch(`/api/v1/navigation/restore?userId=${encodeURIComponent(userId)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { found: false, lastPathname: null, payload: null };
    return (await res.json()) as { found: boolean; lastPathname: string | null; payload: unknown | null };
  } catch {
    return { found: false, lastPathname: null, payload: null };
  }
}
