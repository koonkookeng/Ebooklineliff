// SSOT Phase 125 Task 1 §4.2 — multi-region replica router (port-based)
// Canonical: apps/backend/src/infra/database/replica-router.ts
// (legacy src/infra/database/replica-router.ts)
// - RISK_CALL (documented): port-based explicit routing instead of
//   @prisma/extension-read-replicas (not installed; zero-dep rule).
//   Env provides the primary + per-region replica URLs; selection is the
//   SSOT nearestReadableNode helper (distance + health + lag trip).
//   Writes always resolve the primary (Gate 7).
// - Zero new deps.
import {
  nearestReadableNode,
  type EdgeNode,
  type RegionZone,
} from '@repo/shared';

export interface ReplicaTopology {
  primaryUrl: string;
  replicas: EdgeNode[];
}

/** Read URLs from env (primary + optional per-region replicas). */
export function topologyFromEnv(env: Record<string, string | undefined> = process.env): ReplicaTopology {
  const primaryUrl = env['DATABASE_URL'] ?? '';
  const candidates: Array<[RegionZone, string | undefined]> = [
    ['ASIA_SOUTHEAST_BANGKOK', env['DATABASE_REPLICA_ASIA_SE']],
    ['ASIA_SOUTHEAST_SINGAPORE', env['DATABASE_REPLICA_ASIA_SE_SG'] ?? env['DATABASE_REPLICA_ASIA_SE']],
    ['ASIA_EAST_TOKYO', env['DATABASE_REPLICA_ASIA_EAST']],
    ['US_WEST_OREGON', env['DATABASE_REPLICA_US_WEST']],
  ];
  const replicas: EdgeNode[] = [];
  for (const [region, url] of candidates) {
    if (url) replicas.push({ region, status: 'HEALTHY', replicationLagMs: 0, url });
  }
  return { primaryUrl, replicas };
}

/** Read target for a client region (nearest readable replica, else primary). */
export function resolveReadUrl(topology: ReplicaTopology, clientRegion: RegionZone): { url: string; region: RegionZone | 'PRIMARY'; replica: boolean } {
  const node = nearestReadableNode(clientRegion, topology.replicas);
  if (node) return { url: node.url, region: node.region, replica: true };
  return { url: topology.primaryUrl, region: 'PRIMARY', replica: false };
}

/** Write target is always the primary (Gate 7: no replica writes). */
export function resolveWriteUrl(topology: ReplicaTopology): string {
  return topology.primaryUrl;
}
