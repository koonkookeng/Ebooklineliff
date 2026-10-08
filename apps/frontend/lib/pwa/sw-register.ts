// SSOT Phase 062 §6.1/§2.2 — Service worker registration lifecycle
// Canonical: apps/frontend/lib/pwa/sw-register.ts
// (legacy src/frontend/lib/pwa/sw-register.ts)
// - 5 states: LIFF_INIT (probing) → IDLE (active) / LOADING (installing) →
//   SUCCESS (controlled) / ERROR (unsupported/failed + retry).
// - updatefound → SKIP_WAITING handshake (pairs with sw-update-handler);
//   ZENE_FLUSH_SYNC_QUEUE messages → bg flush. Zero new deps.
'use client';

import { flushSyncQueue } from './background-sync';

export type SwRegistrationState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface SwStatus {
  state: SwRegistrationState;
  scope: string | null;
  updated: boolean;
}

type Listener = (s: SwStatus) => void;

const listeners = new Set<Listener>();
let current: SwStatus = { state: 'LIFF_INIT', scope: null, updated: false };
let started = false;

function emit(): void {
  for (const fn of listeners) {
    try {
      fn(current);
    } catch {
      // listener faults never break registration
    }
  }
}

export function subscribeSwStatus(fn: Listener): () => void {
  listeners.add(fn);
  try {
    fn(current);
  } catch {
    // initial push best-effort
  }
  return () => {
    listeners.delete(fn);
  };
}

export function getSwStatus(): SwStatus {
  return current;
}

export async function initServiceWorker(): Promise<SwStatus> {
  if (started) return current;
  started = true;
  try {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      current = { state: 'ERROR', scope: null, updated: false };
      emit();
      return current;
    }
    current = { state: 'LOADING', scope: null, updated: false };
    emit();
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    current = { state: 'IDLE', scope: reg.scope, updated: false };
    emit();
    reg.addEventListener('updatefound', () => {
      current = { ...current, updated: true };
      emit();
      reg.installing?.addEventListener('statechange', () => {
        if (reg.installing?.state === 'activated' || reg.waiting) {
          reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && (event.data.type === 'ZENE_FLUSH_SYNC_QUEUE' || event.data.type === 'ZENE_BULK_QUEUED')) {
        void flushSyncQueue();
      }
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      current = { state: 'SUCCESS', scope: reg.scope, updated: false };
      emit();
    });
    if (navigator.serviceWorker.controller) {
      current = { state: 'SUCCESS', scope: reg.scope, updated: false };
      emit();
    }
    window.addEventListener('online', () => {
      void flushSyncQueue();
    });
    return current;
  } catch {
    current = { state: 'ERROR', scope: null, updated: false };
    emit();
    return current;
  }
}
