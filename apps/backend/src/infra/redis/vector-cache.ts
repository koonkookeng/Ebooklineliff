// SSOT Phase 038 Task 8 — Vector chunk edge cache (24h warm path)
// Canonical: apps/backend/src/infra/redis/vector-cache.ts
// (legacy src/backend/infra/redis/vector-cache.ts)
// - Key chunkR2Path (BDD Scenario 1 <20ms hit path); 24h TTL; fail-open reads.
// - The pipeline warms this cache right after each R2 upload (<5s path).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from './redis-cluster.service';
import { PIPELINE_CHUNK_TTL_SEC, chunkCacheKey } from '@repo/shared';

@Injectable()
export class VectorCacheService {
  constructor(private readonly redis: RedisClusterService) {}

  key(objectKey: string): string {
    return chunkCacheKey(objectKey);
  }

  async get(objectKey: string): Promise<string | null> {
    return this.redis.get(this.key(objectKey)).catch(() => null);
  }

  async set(objectKey: string, payload: string, ttlSeconds: number = PIPELINE_CHUNK_TTL_SEC): Promise<void> {
    await this.redis.setex(this.key(objectKey), ttlSeconds, payload).catch(() => undefined);
  }

  async del(objectKey: string): Promise<void> {
    await this.redis.del(this.key(objectKey)).catch(() => undefined);
  }
}
