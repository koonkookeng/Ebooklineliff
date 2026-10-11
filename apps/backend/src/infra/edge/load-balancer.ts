// SSOT Phase 125 Task 3 §8.2 — edge geo-routing balancer (pure)
// Canonical: apps/backend/src/infra/edge/load-balancer.ts
// (legacy src/infra/edge/load-balancer.ts)
// - Pure routing over the SSOT helpers: country → region → nearest
//   readable node → ordered failover chain (BDD-2 200ms budget is met by
//   trying the chain head-first with per-attempt timeouts in the caller).
//   No I/O here (testable without sockets). Zero new deps.
import {
  failoverOrder,
  nearestReadableNode,
  regionForCountry,
  type EdgeNode,
  type RegionZone,
} from '@repo/shared';

export interface EdgeRoute {
  clientRegion: RegionZone;
  primary: EdgeNode | null;
  failover: EdgeNode[];
}

/** Full route plan for a request (country code from CF-IPCountry). */
export function planEdgeRoute(countryCode: string, nodes: EdgeNode[]): EdgeRoute {
  const clientRegion = regionForCountry(countryCode);
  return {
    clientRegion,
    primary: nearestReadableNode(clientRegion, nodes),
    failover: failoverOrder(clientRegion, nodes),
  };
}

/** Pick the route head, skipping known-bad regions (consecutive 5xx). */
export function pickRouteHead(plan: EdgeRoute, badRegions: ReadonlySet<string> = new Set()): EdgeNode | null {
  for (const node of plan.failover) {
    if (!badRegions.has(node.region)) return node;
  }
  return plan.primary;
}
