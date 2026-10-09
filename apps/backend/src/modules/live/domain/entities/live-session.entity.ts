// SSOT Phase 099 §4.1/§5.1 — Live session entity (pure status machine)
// Canonical: apps/backend/src/modules/live/domain/entities/live-session.entity.ts
// - Forward-only lifecycle: SCHEDULED → STARTING → LIVE ⇄ PAUSED → ENDED →
//   ARCHIVED. Join allowed only in LIVE/PAUSED with entitlement.
// - Pure (no imports). Zero new deps.
export type LiveStatus = 'SCHEDULED' | 'STARTING' | 'LIVE' | 'PAUSED' | 'ENDED' | 'ARCHIVED';

const NEXT: Record<LiveStatus, LiveStatus[]> = {
  SCHEDULED: ['STARTING'],
  STARTING: ['LIVE', 'SCHEDULED'],
  LIVE: ['PAUSED', 'ENDED'],
  PAUSED: ['LIVE', 'ENDED'],
  ENDED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function canTransition(from: LiveStatus, to: LiveStatus): boolean {
  return (NEXT[from] ?? []).includes(to);
}

export function assertTransition(from: LiveStatus, to: LiveStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal live transition ${from} → ${to}`);
  }
}

export function isJoinable(status: LiveStatus): boolean {
  return status === 'LIVE' || status === 'PAUSED';
}

export function isVodEligible(status: LiveStatus): boolean {
  return status === 'ENDED' || status === 'ARCHIVED';
}
