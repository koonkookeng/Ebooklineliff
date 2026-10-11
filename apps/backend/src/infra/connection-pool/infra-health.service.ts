// SSOT Phase 125 Task 4 §5.1 — infra health core (decorator-free)
// Canonical: apps/backend/src/infra/connection-pool/infra-health.service.ts
// - Behavior behind the public health webhook as plain methods (the
//   @Query() decorator shell stays unimportable under plain tsx, 123
//   precedent — covered here + static-gated there).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { nodeIsReadable, type EdgeNode, type RegionZone } from '@repo/shared';
import { DatabaseReplicaService } from './database-replica.service';

export type ReplicaRowView = {
  regionZone: string;
  isPrimary: boolean;
  isActive: boolean;
  currentLagMs: number;
};

/** Redacted per-node view (status + lag only; Gate 4). */
export function toPublicRow(row: ReplicaRowView): { regionZone: string; readable: boolean; lagMs: number; active: boolean } {
  const node: EdgeNode = {
    region: row.regionZone as RegionZone,
    status: !row.isActive ? 'UNHEALTHY' : 'HEALTHY',
    replicationLagMs: row.currentLagMs,
    url: '',
  };
  return { regionZone: row.regionZone, readable: nodeIsReadable(node), lagMs: row.currentLagMs, active: row.isActive };
}

@Injectable()
export class InfraHealthService {
  constructor(private readonly replicas: DatabaseReplicaService) {}

  async health(region: string | undefined): Promise<{ ok: boolean; at: string; route?: unknown }> {
    const primaryUrl = process.env['DATABASE_URL'] ?? '';
    const read = region ? await this.replicas.readUrl(region as RegionZone, primaryUrl) : null;
    return { ok: true, at: new Date().toISOString(), ...(read ? { route: read } : {}) };
  }
}
