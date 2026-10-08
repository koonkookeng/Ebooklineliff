// SSOT Phase 076 §10 — Carrier circuit breaker + priority failover
// Canonical: apps/backend/src/modules/fulfillment/application/circuit-breaker.ts
// - 3 consecutive failures open the carrier; the next booking attempt fails
//   over to the next carrier in CARRIER_PRIORITY (Flash -> KEX -> J&T ...).
// - Pure + injectable clock/store so contract tests run DB-free.
// - Zero new deps.
import { CARRIER_FAILOVER_THRESHOLD } from '@repo/shared';
import { CARRIER_PRIORITY } from '../adapters/carrier.adapter';

export interface BreakerStore {
  failures(provider: string): number;
  recordFailure(provider: string): number;
  recordSuccess(provider: string): void;
}

export function inMemoryBreakerStore(): BreakerStore {
  const counts = new Map<string, number>();
  return {
    failures: (p) => counts.get(p) ?? 0,
    recordFailure: (p) => {
      const n = (counts.get(p) ?? 0) + 1;
      counts.set(p, n);
      return n;
    },
    recordSuccess: (p) => { counts.delete(p); },
  };
}

export function isCircuitOpen(store: BreakerStore, provider: string, threshold = CARRIER_FAILOVER_THRESHOLD): boolean {
  return store.failures(provider) >= threshold;
}

/** Next healthy carrier after `failed` (priority order, skip open circuits). */
export function failoverCarrier(store: BreakerStore, failed: string): string | null {
  const ix = CARRIER_PRIORITY.indexOf(failed as (typeof CARRIER_PRIORITY)[number]);
  for (let i = ix + 1; i < CARRIER_PRIORITY.length; i++) {
    const candidate = CARRIER_PRIORITY[i] as string;
    if (!isCircuitOpen(store, candidate)) return candidate;
  }
  return null;
}
