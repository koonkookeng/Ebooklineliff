// SSOT Phase 031 §5.1 — Keep-alive viewport entity (preservation invariants)
// Canonical: apps/backend/src/modules/keep-alive/domain/keep-alive.entity.ts
// (legacy src/backend/modules/keep-alive/domain/keep-alive.entity.ts)
// - Guards the cross-device sync path: known viewport vocabulary, rooted
//   identity, state payload capped at 32KB (RAM/row guard, Gate 5).
// - Zero new deps.
import { ViewportTypeEnum, type ViewportType } from '@repo/shared';

/** Max serialized viewport payload (bytes) — IDB/row budget. */
export const KEEPALIVE_STATE_MAX_BYTES = 32 * 1024;

export interface KeepAliveProps {
  userId: string;
  tenantId: string;
  viewportType: ViewportType;
  stateJson: unknown;
  timestamp: number;
}

export class KeepAliveState {
  private constructor(readonly props: KeepAliveProps) {}

  static create(props: KeepAliveProps): KeepAliveState {
    if (!props.userId || !props.tenantId) throw new Error('Missing keep-alive identity');
    if (!ViewportTypeEnum.options.includes(props.viewportType)) throw new Error('Unknown viewport type');
    if (!Number.isInteger(props.timestamp) || props.timestamp < 0) throw new Error('Invalid timestamp');
    const bytes = JSON.stringify(props.stateJson ?? null).length;
    if (bytes > KEEPALIVE_STATE_MAX_BYTES) throw new Error('Viewport state exceeds 32KB budget');
    return new KeepAliveState(props);
  }
}
