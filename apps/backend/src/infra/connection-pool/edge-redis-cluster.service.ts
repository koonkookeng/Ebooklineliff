// SSOT Phase 125 Task 5 §5.1 — Redis cluster region switcher (service)
// Canonical: apps/backend/src/infra/connection-pool/edge-redis-cluster.service.ts
// (legacy src/backend/infra/connection-pool/edge-redis-cluster.service.ts)
// - NestJS injectable adapting RedisClusterService (setex arg order:
//   key/ttl/value) to the EdgeCachePort (key/value/ttl). Single cluster
//   client, region-tagged keys — no new connections.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import type { RegionZone } from '@repo/shared';
import { RedisClusterService } from '../redis/redis-cluster.service';
import { EdgeRedisClusterService } from '../redis/edge-cluster';

@Injectable()
export class EdgeRegionCacheService {
  private readonly lane: EdgeRedisClusterService;

  constructor(redis: RedisClusterService) {
    this.lane = new EdgeRedisClusterService({
      get: (key: string) => redis.get(key),
      set: (key: string, value: string, ttlSeconds: number) => redis.setex(key, ttlSeconds, value),
    });
  }

  regionFor(countryCode: string): RegionZone {
    return this.lane.regionFor(countryCode);
  }

  get(region: RegionZone, tenantId: string, scope: string): Promise<string | null> {
    return this.lane.get(region, tenantId, scope);
  }

  set(region: RegionZone, tenantId: string, scope: string, value: string, ttlSeconds: number): Promise<void> {
    return this.lane.set(region, tenantId, scope, value, ttlSeconds);
  }
}

export { EdgeRedisClusterService };
/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { EdgeRegionCacheService as EdgeRedisClusterServiceService };
