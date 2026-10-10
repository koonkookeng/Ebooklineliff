// SSOT Phase 119 Task 4 — device session client (REST + SSE eviction feed)
// Canonical: apps/frontend/lib/fingerprint/device-session-client.ts
// - Handshake/heartbeat/ticket/evict/devices/revoke REST + SSE eviction
//   listener (EventSource, fail-open reconnect). Heartbeat cadence 5s is
//   owned by the player shell (HEARTBEAT_CADENCE_SEC).
// - Zero-dep (fetch + EventSource only).
export type DeviceSessionState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface HandshakeResult {
  deviceId: string;
  fingerprintHash: string;
  trusted: boolean;
  isNew: boolean;
  sessionToken: string;
  expiresAt: string;
}

export interface HeartbeatResult {
  ok: boolean;
  takenOver: boolean;
  evictedDeviceId?: string;
  elapsedMs: number;
}

export interface BoundDeviceView {
  id: string;
  deviceName: string;
  deviceType: string;
  isTrusted: boolean;
  lastIpAddress: string;
  lastActiveAt: string;
  fingerprintFragment: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`device-session ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function deviceSessionApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    handshake: (body: { fingerprint: Record<string, unknown>; lessonId: string; deviceName?: string }) =>
      post(`/api/v1/security/device/handshake?${qs}`, body) as Promise<HandshakeResult>,
    heartbeat: (body: { lessonId: string; sessionToken: string; fingerprintHash: string; playbackPositionSec: number }) =>
      post(`/api/v1/security/device/heartbeat?${qs}`, body) as Promise<HeartbeatResult>,
    streamKey: (sessionToken: string, lessonId: string) =>
      json<{ ticket: string; expiresAt: string }>(
        `/api/v1/security/device/stream-key?${qs}&sessionToken=${encodeURIComponent(sessionToken)}&lessonId=${encodeURIComponent(lessonId)}`,
      ),
    evictOther: () => post(`/api/v1/security/device/evict-other?${qs}`, {}) as Promise<{ revoked: number }>,
    devices: () => json<BoundDeviceView[]>(`/api/v1/security/device/devices?${qs}`),
    revokeDevice: (deviceId: string) => post(`/api/v1/security/device/revoke-device?${qs}`, { deviceId }) as Promise<boolean>,
  };
}

/** SSE eviction feed (server fans out device.evicted; auto-reconnect). */
export function subscribeEvictions(
  sessionToken: string,
  onEvicted: (detail: { evictedDeviceId?: string }) => void,
): () => void {
  try {
    const src = new EventSource(`/api/v1/security/device/events?sessionToken=${encodeURIComponent(sessionToken)}`);
    src.addEventListener('message', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data as string) as { type?: string; evictedDeviceId?: string };
        if (data.type === 'device.evicted') onEvicted({ evictedDeviceId: data.evictedDeviceId });
      } catch {
        onEvicted({});
      }
    });
    src.onerror = () => src.close();
    return () => src.close();
  } catch {
    return () => undefined;
  }
}
