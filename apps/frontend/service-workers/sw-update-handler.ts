// SSOT Phase 033 Task 4 — SW update handler (registration + release fan-out)
// Canonical: apps/frontend/service-workers/sw-update-handler.ts
// (legacy src/frontend/service-workers/sw-update-handler.ts)
// - registerUpdateChannel(): no-op when SW is unsupported; otherwise listens
//   for { type: 'VERSION_RELEASED' } worker messages (BDD Scenario 2 push path —
//   the sender can be any SW/worker the host app installs) and forwards to
//   onReleased without reloading (the checker owns the apply decision).
// - Framework-free, single registration guard (idempotent across mounts).
// - Zero new deps.

export interface ReleasedInfo {
  version?: string;
  buildHash?: string;
}

let registered = false;

export function registerUpdateChannel(onReleased: (info: ReleasedInfo) => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => undefined;
  if (registered) return () => undefined;
  registered = true;
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; version?: unknown; buildHash?: unknown } | null;
    if (!data || data.type !== 'VERSION_RELEASED') return;
    onReleased({
      ...(typeof data.version === 'string' ? { version: data.version } : {}),
      ...(typeof data.buildHash === 'string' ? { buildHash: data.buildHash } : {}),
    });
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => {
    registered = false;
    navigator.serviceWorker.removeEventListener('message', onMessage);
  };
}

export function resetUpdateChannelForTests(): void {
  registered = false;
}
