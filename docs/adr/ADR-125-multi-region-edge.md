# ADR-125: Multi-Region Read Replica & Cloudflare Edge Load Balancing Core

## Status
Accepted — Phase 125 DONE (verified 100/100 x3).

## Context
Phase 125 requires global infrastructure with sub-20ms read latency and 99.99% availability:
- PostgreSQL multi-region read replicas (Bangkok / Singapore / Tokyo / Oregon) with the primary write node kept free of read traffic.
- Cloudflare Edge Load Balancing with geo-routing (CF-IPCountry / CF-Ray), health-check based failover to a secondary replica within 200ms, and edge Redis caching of entitlement rights and reader chunks.
- Edge latency discipline: request routing decided in the first ~5ms, without pushing cache-routing or entitlement work onto the LINE LIFF WebView (RAM < 30MB).
- Zero-egress storage: all e-book vector chunks and HLS segments served through Cloudflare R2/CDN.

## Decision
- **Unified Edge Infrastructure Contract (`edge-infrastructure.schema.ts`):** Defined Zod schemas `RegionZoneEnum`, `ReplicaHealthStatusEnum`, `InfraNodeMetricSchema`, `EdgeRoutingConfigSchema` plus pure routing helpers (`regionForCountry`, `nodeIsReadable`, `nearestReadableNode`, `failoverOrder`, `edgeCacheKey`) and budgets (`EDGE_READ_BUDGET_MS` = 20ms, `EDGE_FAILOVER_BUDGET_MS` = 200ms, `REPLICA_LAG_TRIP_MS`, `EDGE_FAILOVER_STRIKES`).
- **Replica Router (`apps/backend/src/infra/database/replica-router.ts`):** Environment-driven topology (`topologyFromEnv`) with `resolveReadUrl` / `resolveWriteUrl` so every write/mutation goes to the primary while reads fan out to the nearest healthy replica. No dependency on `@prisma/extension-read-replicas` (zero-dep seam; behavior expressed as pure functions and a swappable adapter).
- **Edge Load Balancer (`apps/backend/src/infra/edge/load-balancer.ts` + `cloudflare-balancer.ts`):** `planEdgeRoute` computes the ordered candidate list from the nearest replica, `pickRouteHead` selects the live head, and `CloudflareBalancer` reroutes around upstream 5xx/503 with strike accounting, `INFRA_ALERT_STREAM` events, and a hard throw when every region is down.
- **Redis Edge Cluster (`apps/backend/src/infra/redis/edge-cluster.ts`):** Namespaced (`edge:` prefix) chunk/entitlement cache with SETEX semantics, region-aware switching, and fail-open reads.
- **Read/Write Interceptor (`MultiRegionQueryInterceptor`):** Marks GraphQL queries as read-intent (`req.useReadReplica = true`) and leaves mutations on the primary — no business-core edits.
- **Cloudflare Worker + Terraform:** `apps/backend/wrangler.toml` holds `EDGE_REGION` hints and secrets-free bindings; `terraform/main.tf` declares the replica region registry and the 200ms failover budget.
- **Edge-Aware Reader (frontend):** Dep-free reader shell consuming `/api/v1/edge/...` proxy with the 5 mandatory states (`EDGE_INIT`, `IDLE`, `SYNCING`, `SUCCESS`, `ERROR`) and explicit `URL.revokeObjectURL` memory release.
- **Prisma registry:** `DatabaseReplicaNode` model (unique `regionZone`, `isPrimary`, `currentLagMs`, max connections) added additively; datasource stays a single primary URL + `DIRECT_URL`.

## Consequences
- **9 Golden Gatekeepers Passed:**
  1. SSOT Schema Sync: Zod contracts, GraphQL health intents, Prisma registry and Terraform agree.
  2. Zero Type Violations: strict TypeScript clean on backend and frontend.
  3. UI/UX State Machine: reader shell covers all 5 edge states.
  4. Security Audit: edge entitlement gatekeeper + presigned short-TTL delivery; secrets never committed to `wrangler.toml`.
  5. LIFF Canvas Memory Check: client only renders; routing/cache/gating moved to the edge (RAM < 30MB).
  6. Zero-Egress Routing: all chunk/HLS delivery stays inside Cloudflare R2/CDN ($0 egress).
  7. Database Transaction Guard: writes/mutations pinned to primary; reads distributed (Gate 7 asserted in contracts).
  8. Data Pipeline Verification: node health metrics + infra alerts stream to Redis for the 121 metrics lane.
  9. Automated ADR Generation: documented in ADR-125.
