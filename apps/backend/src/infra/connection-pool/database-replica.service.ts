// SSOT Phase 125 Task 4 §5.1 — dynamic read/write query separator
// Canonical: apps/backend/src/infra/connection-pool/database-replica.service.ts
// (legacy src/backend/infra/connection-pool/database-replica.service.ts)
// - Reads resolve the nearest readable replica row (regionZone + lag +
//   active flags from DatabaseReplicaNode); writes always resolve the
//   primary (Gate 7). DB rows map to SSOT EdgeNodes (UNHEALTHY when
//   inactive; DEGRADED past the lag trip). Empty registry → primary
//   (single-region Deployments keep working).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { REPLICA_LAG_TRIP_MS, type EdgeNode, type RegionZone } from '@repo/shared';
import { resolveReadUrl, resolveWriteUrl } from '../database/replica-router';

export { resolveReadUrl, resolveWriteUrl };

export interface ReplicaRow {
  regionZone: string;
  connectionString: string;
  isPrimary: boolean;
  isActive: boolean;
  currentLagMs: number;
}

/** Minimal Prisma surface (structural; no hard import). */
export interface ReplicaPrismaPort {
  databaseReplicaNode: { findMany(args?: unknown): Promise<ReplicaRow[]> };
}

const KNOWN_ZONES = new Set(['ASIA_SOUTHEAST_BANGKOK', 'ASIA_SOUTHEAST_SINGAPORE', 'ASIA_EAST_TOKYO', 'US_WEST_OREGON']);

function toEdgeNode(row: ReplicaRow): EdgeNode | null {
  if (!KNOWN_ZONES.has(row.regionZone)) return null;
  const region = row.regionZone as RegionZone;
  return {
    region,
    status: !row.isActive ? 'UNHEALTHY' : row.currentLagMs > REPLICA_LAG_TRIP_MS ? 'DEGRADED' : 'HEALTHY',
    replicationLagMs: row.currentLagMs,
    url: row.connectionString,
  };
}

@Injectable()
export class DatabaseReplicaService {
  constructor(private readonly prisma: ReplicaPrismaPort) {}

  private async topology(primaryUrl: string): Promise<{ primaryUrl: string; replicas: EdgeNode[] }> {
    let rows: ReplicaRow[] = [];
    try {
      rows = await this.prisma.databaseReplicaNode.findMany();
    } catch {
      rows = [];
    }
    const replicas: EdgeNode[] = [];
    for (const row of rows) {
      if (row.isPrimary) continue;
      const node = toEdgeNode(row);
      if (node) replicas.push(node);
    }
    return { primaryUrl, replicas };
  }

  /** Read URL for a client region (nearest readable replica, else primary). */
  async readUrl(clientRegion: RegionZone, primaryUrl: string): Promise<{ url: string; region: RegionZone | 'PRIMARY'; replica: boolean }> {
    return resolveReadUrl(await this.topology(primaryUrl), clientRegion);
  }

  /** Write URL is always the primary (Gate 7). */
  writeUrl(primaryUrl: string): string {
    return resolveWriteUrl({ primaryUrl, replicas: [] });
  }
}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { DatabaseReplicaService as DatabaseReplicaServiceService };
