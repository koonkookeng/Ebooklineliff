// SSOT Phase 098 §5.1 — HR dashboard read-through edge cache (<500ms guard)
// Canonical: apps/backend/src/infra/redis/b2b-analytics-cache.service.ts
// - Thin wrapper over RedisClusterService: get/set with EX TTL, fail-open
//   (analytics must never 500 on Redis blips). Zero new deps.
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from './redis-cluster.service';

@Injectable()
export class B2bAnalyticsCacheService {
  constructor(private readonly redis: RedisClusterService) {}

  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    try {
      await this.redis.set(key, value, 'EX', ttlSec);
    } catch {
      // fail-open: dashboard recomputes from Postgres
    }
  }

  async invalidate(organizationId: string): Promise<void> {
    try {
      await this.redis.del(`b2b:hr:dashboard:${organizationId}`);
    } catch {
      // fail-open
    }
  }
}
