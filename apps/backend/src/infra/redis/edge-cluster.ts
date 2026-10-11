// SSOT Phase 125 Task 5 §5.1 — Redis edge cluster region switcher
// Canonical: apps/backend/src/infra/redis/edge-cluster.ts
// (legacy src/infra/redis/edge-cluster.ts)
// - Region-aware key scoping over the SSOT edgeCacheKey builder: callers
//   keep one cluster client (no new connections); this lane owns the
//   region tag + nearest-region resolution for entitlement/chunk caches.
//   Pure resolution + thin namespaced get/set delegates (structural port).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { edgeCacheKey, regionForCountry, type RegionZone } from '@repo/shared';

/** Minimal cache surface (structural; cluster service satisfies it). */
export interface EdgeCachePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

@Injectable()
export class EdgeRedisClusterService {
  constructor(private readonly cache: EdgeCachePort) {}

  /** Resolve the serving region for a request country. */
  regionFor(countryCode: string): RegionZone {
    return regionForCountry(countryCode);
  }

  /** Namespaced read (tenant-isolated, region-tagged). */
  get(region: RegionZone, tenantId: string, scope: string): Promise<string | null> {
    return this.cache.get(edgeCacheKey(region, tenantId, scope));
  }

  /** Namespaced write (tenant-isolated, region-tagged). */
  set(region: RegionZone, tenantId: string, scope: string, value: string, ttlSeconds: number): Promise<void> {
    return this.cache.set(edgeCacheKey(region, tenantId, scope), value, ttlSeconds);
  }
}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { EdgeRedisClusterService as EdgeRedisClusterServiceService };
