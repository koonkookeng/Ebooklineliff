// SSOT Phase 059 §6.1/§7.1 — Reader navigation client (prefs + beacon)
// Canonical: apps/frontend/lib/reader/reader-navigation-client.ts
// - fetchReaderNavPreference: Next proxy → backend (fail-open defaults).
// - reportNavigationEvent: sendBeacon-first analytics pulse (§7.1 device
//   ratio / flip-speed / dwell signals; never breaks paging).
// - Zero new deps.
import {
  NavigationEventPayloadSchema,
  UserReaderPreferenceSchema,
  type NavigationEventPayload,
  type UserReaderPreference,
} from '@repo/shared';

export async function fetchReaderNavPreference(): Promise<UserReaderPreference | null> {
  try {
    const res = await fetch('/api/v1/reader/navigation-preference');
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok || !data) return null;
    const parsed = UserReaderPreferenceSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function reportNavigationEvent(event: Omit<NavigationEventPayload, 'timestamp'>): void {
  try {
    const payload: NavigationEventPayload = { ...event, timestamp: new Date().toISOString() };
    if (!NavigationEventPayloadSchema.safeParse(payload).success) return;
    const body = JSON.stringify(payload);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon('/api/v1/reader/navigation-event', blob)) return;
    }
    void fetch('/api/v1/reader/navigation-event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // analytics never breaks navigation
  }
}
