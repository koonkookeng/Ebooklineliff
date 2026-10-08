// SSOT Phase 057 §2.2/§5.1 — Conflict resolver (Last-Write-Wins + Max-Progress)
// Canonical: apps/backend/src/modules/sync/domain/services/conflict-resolver.service.ts
// (legacy src/backend/modules/sync/domain/services/conflict-resolver.service.ts)
// - SYNC_CONFLICT: two devices report divergent positions. Policy: the newer
//   clientTimestamp wins the broadcast; the persisted cursor keeps the MAX
//   (never regress a reader on reconnect flush, §10.1).
// - Constructor takes no ports — pure + tsx-importable.
import { Injectable } from '@nestjs/common';
import { lastWriteWins } from '@repo/shared';

export interface ProgressCursor {
  position: number;
  clientTimestamp: number;
  deviceId: string;
}

@Injectable()
export class ConflictResolverService {
  /** Broadcast winner: newer clientTimestamp (Last-Write-Wins). */
  resolveBroadcast(local: ProgressCursor, remote: ProgressCursor): ProgressCursor {
    if (local.deviceId === remote.deviceId) return remote;
    return lastWriteWins(local.clientTimestamp, remote.clientTimestamp) === 'b' ? remote : local;
  }

  /** Persisted cursor: max position wins (reconnect flush never regresses). */
  resolvePersisted(stored: number, incoming: number): number {
    return Math.max(stored, incoming);
  }
}
