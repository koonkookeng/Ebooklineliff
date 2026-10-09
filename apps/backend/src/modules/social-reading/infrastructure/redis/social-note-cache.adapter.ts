// SSOT Phase 095 Task 4 — Social note edge-cache adapter (Redis, 60s pages)
// Canonical: apps/backend/src/modules/social-reading/infrastructure/redis/social-note-cache.adapter.ts
// - Thin tenant-safe wrapper: page payloads (60s) + explicit invalidate on
//   write paths. Fail-open (reader never blocks on cache). Zero new deps.
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../../infra/redis/redis-cluster.service';

@Injectable()
export class SocialNoteCacheAdapter {
  constructor(private readonly redis: RedisClusterService) {}

  get(key: string): Promise<string | null> {
    return this.redis.get(key).catch(() => null);
  }

  set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown> {
    return this.redis.set(key, value, ...args).catch(() => undefined);
  }

  del(...keys: string[]): Promise<void> {
    return this.redis.del(...keys).catch(() => undefined);
  }
}
