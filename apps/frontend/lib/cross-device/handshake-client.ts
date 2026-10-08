// SSOT Phase 070 Task 4/5 — Handoff client (handshake + position transport)
// Canonical: apps/frontend/lib/cross-device/handshake-client.ts
// - issue/authorize ride Next proxies (JWT); QR pixels render client-side
//   (react-qr-code, Phase 007 precedent — no server QR dependency).
// - Position push/latest ride the same proxies; analytics event best-effort.
// - Zero new deps.
import type { SessionHandshakeQrPayload } from '@repo/shared';

const HANDOFF_KEY = 'zene-handoff';

export interface HandoffIdentity {
  userId: string;
  sessionFingerprint: string;
  targetRedirectUrl?: string;
  at: number;
}

export function loadHandoff(): HandoffIdentity | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as HandoffIdentity;
  } catch {
    return null;
  }
}

export function saveHandoff(identity: HandoffIdentity): void {
  try {
    localStorage.setItem(HANDOFF_KEY, JSON.stringify(identity));
  } catch {
    // storage best-effort
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

/** Desktop: mint a one-time QR handshake (120s TTL). */
export function issueHandshakeQr(targetRedirectUrl: string): Promise<SessionHandshakeQrPayload> {
  return fetch('/api/v1/sync/handshake/issue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targetRedirectUrl }),
  }).then((res) => asJson(res, 'Issue handshake') as Promise<SessionHandshakeQrPayload>);
}

/** LIFF: consume a scanned token (single-use; DEVICE_LIMIT possible). */
export function authorizeHandshake(handshakeToken: string, webSessionId: string): Promise<{ sessionFingerprint: string }> {
  return fetch('/api/v1/sync/handshake/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handshakeToken, webSessionId }),
  }).then((res) => asJson(res, 'Authorize handshake') as Promise<{ sessionFingerprint: string }>);
}

export function fetchLatestPosition(productId: string, contentType: string): Promise<Record<string, unknown> | null> {
  return fetch(`/api/v1/sync/position?productId=${encodeURIComponent(productId)}&contentType=${encodeURIComponent(contentType)}`)
    .then((res) => (res.ok ? (res.json() as Promise<Record<string, unknown>>) : null))
    .catch(() => null);
}

/** LIFF camera scan (liff.scanCodeV2) with manual-token fallback. */
export async function scanHandshakeToken(): Promise<string | null> {
  try {
    const liff = (await import('@line/liff')).default as unknown as {
      scanCodeV2?: () => Promise<{ value?: string | null }>;
    };
    if (typeof liff.scanCodeV2 !== 'function') return null;
    const result = await liff.scanCodeV2();
    const raw = String(result.value ?? '');
    const token = raw.split('/').pop()?.split('?').pop()?.split('=').pop() ?? raw;
    return token || null;
  } catch {
    return null;
  }
}
