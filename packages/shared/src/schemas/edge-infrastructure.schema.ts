// SSOT Phase 125 §3.1 — multi-region edge infrastructure contract
// Canonical: packages/shared/src/schemas/edge-infrastructure.schema.ts
// (legacy src/shared/schemas/sdid-edge-contract.ts)
// - Spec-verbatim: RegionZoneEnum (4 zones) / ReplicaHealthStatusEnum /
//   InfraNodeMetricSchema / EdgeRoutingConfigSchema.
// - RISK_CALL deviations (additive-only, documented):
//   - tenantId accepts min(1) slugs (spec uuid is the narrow case;
//     023-031 precedent).
//   - Node URLs accept min(1) endpoint strings (spec url() rejects
//     internal hosts like `pg-replica-1:5432`; edge vocabulary is
//     host-first, validated at dial time).
// - Pure helpers: nearest-region routing, health verdicts, failover
//   ordering, key builders, budgets. Zero new deps (zod only).
import { z } from 'zod';

export const RegionZoneEnum = z.enum([
  'ASIA_SOUTHEAST_BANGKOK',
  'ASIA_SOUTHEAST_SINGAPORE',
  'ASIA_EAST_TOKYO',
  'US_WEST_OREGON',
]);
export type RegionZone = z.infer<typeof RegionZoneEnum>;

export const ReplicaHealthStatusEnum = z.enum(['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'MAINTENANCE']);
export type ReplicaHealthStatus = z.infer<typeof ReplicaHealthStatusEnum>;

export const InfraNodeMetricSchema = z.object({
  region: RegionZoneEnum,
  replicaStatus: ReplicaHealthStatusEnum,
  replicationLagMs: z.number().nonnegative(),
  activeConnections: z.number().int().nonnegative(),
  cpuUsagePercent: z.number().min(0).max(100),
  memoryUsagePercent: z.number().min(0).max(100),
  timestamp: z.string().datetime(),
});
export type InfraNodeMetric = z.infer<typeof InfraNodeMetricSchema>;

export const EdgeRoutingConfigSchema = z.object({
  tenantId: z.string().min(1),
  clientRegion: RegionZoneEnum,
  primaryWriteNodeUrl: z.string().min(1),
  assignedReadReplicaUrl: z.string().min(1),
  cacheTtlSec: z.number().int().positive(),
});
export type EdgeRoutingConfig = z.infer<typeof EdgeRoutingConfigSchema>;

/** BDD-1: edge read latency ceiling (20ms). */
export const EDGE_READ_BUDGET_MS = 20;
/** BDD-2: replica failover ceiling (200ms) + 5xx/timeout trip (500ms). */
export const EDGE_FAILOVER_BUDGET_MS = 200;
export const EDGE_UNHEALTHY_AFTER_MS = 500;
/** §2.1: tenant/geo resolution budget at the edge (5ms). */
export const EDGE_RESOLVE_BUDGET_MS = 5;
/** Health probe cadence + replication lag trip. */
export const EDGE_HEALTH_PROBE_SEC = 30;
export const REPLICA_LAG_TRIP_MS = 1000;
/** Consecutive failures before a node is routed around. */
export const EDGE_FAILOVER_STRIKES = 2;

/** Approximate inter-region latency matrix (ms, symmetric). */
const REGION_DISTANCE_MS: Record<string, Record<string, number>> = {
  ASIA_SOUTHEAST_BANGKOK: { ASIA_SOUTHEAST_BANGKOK: 0, ASIA_SOUTHEAST_SINGAPORE: 25, ASIA_EAST_TOKYO: 90, US_WEST_OREGON: 180 },
  ASIA_SOUTHEAST_SINGAPORE: { ASIA_SOUTHEAST_BANGKOK: 25, ASIA_SOUTHEAST_SINGAPORE: 0, ASIA_EAST_TOKYO: 75, US_WEST_OREGON: 165 },
  ASIA_EAST_TOKYO: { ASIA_SOUTHEAST_BANGKOK: 90, ASIA_SOUTHEAST_SINGAPORE: 75, ASIA_EAST_TOKYO: 0, US_WEST_OREGON: 110 },
  US_WEST_OREGON: { ASIA_SOUTHEAST_BANGKOK: 180, ASIA_SOUTHEAST_SINGAPORE: 165, ASIA_EAST_TOKYO: 110, US_WEST_OREGON: 0 },
};

export interface EdgeNode {
  region: RegionZone;
  status: ReplicaHealthStatus;
  replicationLagMs: number;
  url: string;
}

/** True when a node may serve reads (healthy, or degraded within lag trip). */
export function nodeIsReadable(node: EdgeNode): boolean {
  if (node.status === 'HEALTHY') return true;
  if (node.status === 'DEGRADED') return node.replicationLagMs <= REPLICA_LAG_TRIP_MS;
  return false;
}

/** Nearest readable node to the client region (null when all routed around). */
export function nearestReadableNode(clientRegion: RegionZone, nodes: EdgeNode[]): EdgeNode | null {
  const distances = REGION_DISTANCE_MS[clientRegion] ?? {};
  const readable = nodes.filter(nodeIsReadable);
  readable.sort((a, b) => (distances[a.region] ?? 9999) - (distances[b.region] ?? 9999));
  return readable[0] ?? null;
}

/** Failover order: readable-first by distance, then the rest by distance. */
export function failoverOrder(clientRegion: RegionZone, nodes: EdgeNode[]): EdgeNode[] {
  const distances = REGION_DISTANCE_MS[clientRegion] ?? {};
  return [...nodes].sort((a, b) => {
    const ra = nodeIsReadable(a) ? 0 : 1;
    const rb = nodeIsReadable(b) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return (distances[a.region] ?? 9999) - (distances[b.region] ?? 9999);
  });
}

/** Country → nearest region zone (CF-IPCountry lane, fallback Singapore hub). */
export function regionForCountry(countryCode: string): RegionZone {
  const cc = countryCode.trim().toUpperCase();
  if (cc === 'TH') return 'ASIA_SOUTHEAST_BANGKOK';
  if (cc === 'JP' || cc === 'KR' || cc === 'CN' || cc === 'TW') return 'ASIA_EAST_TOKYO';
  if (cc === 'US' || cc === 'CA' || cc === 'MX' || cc === 'BR') return 'US_WEST_OREGON';
  return 'ASIA_SOUTHEAST_SINGAPORE';
}

/** Region-scoped edge cache key (tenant-isolated). */
export function edgeCacheKey(region: RegionZone, tenantId: string, scope: string): string {
  return `edge:${region}:${tenantId}:${scope}`;
}

/** Infra alert stream for failover events (§7.1 telemetry). */
export const INFRA_ALERT_STREAM = 'stream:infra-alerts';
