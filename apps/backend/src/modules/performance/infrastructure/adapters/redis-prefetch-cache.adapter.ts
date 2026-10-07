// SSOT Phase 029 §5.1 — Redis prefetch edge-cache adapter (cluster-safe ops)
// Canonical: apps/backend/src/modules/performance/infrastructure/adapters/redis-prefetch-cache.adapter.ts
// (legacy src/backend/modules/performance/.../redis-prefetch-cache.adapter.ts)
// - RISK_CALL deviation (documented): spec §5.2 calls redis.exists()/set(EX);
//   RedisClusterService exposes get/setex (same semantics, cluster-safe) —
//   exists() here is get() !== null. No new methods added to shared infra.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../../infra/redis/redis-cluster.service';

@Injectable()
export class RedisPrefetchCacheAdapter {
  constructor(private readonly redis: RedisClusterService) {}

  async exists(key: string): Promise<boolean> {
    const hit = await this.redis.get(key).catch(() => null);
    return hit !== null;
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key).catch(() => null);
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    await this.redis.setex(key, ttlSeconds, value).catch(() => undefined);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key).catch(() => undefined);
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.redis.publish(channel, message).catch(() => undefined);
  }
}
