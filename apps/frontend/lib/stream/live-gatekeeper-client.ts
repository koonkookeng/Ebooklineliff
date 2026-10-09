// SSOT Phase 100 — Gatekeeper client (REST + SSE transport)
// Canonical: apps/frontend/lib/stream/live-gatekeeper-client.ts
// - Zero-dep (fetch + EventSource only — RAM guard).
export type GateStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface GateAccess {
  accessStatus: string;
  playbackToken: string | null;
  hlsStreamUrl: string | null;
  tokenExpiresAt: number;
  heartbeatIntervalSec: number;
  watermarkPayload: { userIdHash: string; displayName: string; ipAddress: string; timestamp: string };
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`gate ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

function fingerprint(): string {
  try {
    return `${navigator.userAgent}:${window.screen.width}`;
  } catch {
    return 'unknown';
  }
}

/** Extract the sessionToken (part 3 of room.user.session.exp) from a gate token. */
export function sessionTokenOf(playbackToken: string): string {
  try {
    const body = atob(playbackToken.split('.')[0]?.replace(/-/g, '+').replace(/_/g, '/') ?? '');
    return body.split('.')[2] ?? '';
  } catch {
    return '';
  }
}

export function gateApi() {  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    deviceFingerprint: fingerprint,
    token: (liveRoomId: string) =>
      post('/api/v1/live-access/token', { liveRoomId, deviceFingerprint: fingerprint() }) as Promise<GateAccess>,
    heartbeat: (body: { sessionToken: string; liveRoomId: string; currentPlaybackSec: number }) =>
      post('/api/v1/live-access/heartbeat', { ...body, deviceFingerprint: fingerprint() }) as Promise<{
        status: 'OK' | 'KICKED';
        nextHeartbeatMs: number;
      }>,
    kickStream: (liveRoomId: string, userId: string) =>
      new EventSource(
        `/api/v1/live-access/rooms/${encodeURIComponent(liveRoomId)}/kick-stream?userId=${encodeURIComponent(userId)}`,
      ),
  };
}
