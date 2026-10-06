// SSOT Phase 009 §5.2/§8.1 — Redis search cache adapter (edge TTL + rate-limit + analytics stream)
// Canonical: apps/backend/src/modules/catalog/infrastructure/persistence/redis-search-cache.adapter.ts
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../../infra/redis/redis-cluster.service';
import { predictiveCacheKey, searchCacheKey, type ProductFilterInput } from '@repo/shared';

const CATALOG_TTL_SEC = 60;
const PREDICTIVE_TTL_SEC = 30;
const RATE_LIMIT_PER_MIN = 30;
const RATE_WINDOW_SEC = 60;

@Injectable()
export class RedisSearchCacheAdapter {
  constructor(private readonly redis: RedisClusterService) {}

  async getCatalog(filter: ProductFilterInput): Promise<string | null> {
    return this.redis.get(searchCacheKey(filter)).catch(() => null);
  }

  async setCatalog(filter: ProductFilterInput, payload: string): Promise<void> {
    await this.redis.setex(searchCacheKey(filter), CATALOG_TTL_SEC, payload).catch(() => undefined);
  }

  async getPredictive(query: string, limit: number): Promise<string | null> {
    return this.redis.get(predictiveCacheKey(query, limit)).catch(() => null);
  }

  async setPredictive(query: string, limit: number, payload: string): Promise<void> {
    await this.redis.setex(predictiveCacheKey(query, limit), PREDICTIVE_TTL_SEC, payload).catch(() => undefined);
  }

  /** Sliding-window rate limit: 30 predictive requests/min per LINE user (anti-scrape). */
  async checkPredictiveRateLimit(lineUserId: string): Promise<{ allowed: boolean; remaining: number }> {
    const key = `search:ratelimit:${lineUserId}`;
    try {
      const raw = await this.redis.get(key);
      const count = raw ? Number(raw) || 0 : 0;
      if (count >= RATE_LIMIT_PER_MIN) return { allowed: false, remaining: 0 };
      await this.redis.setex(key, RATE_WINDOW_SEC, String(count + 1));
      return { allowed: true, remaining: RATE_LIMIT_PER_MIN - count - 1 };
    } catch {
      return { allowed: true, remaining: RATE_LIMIT_PER_MIN }; // fail-open (availability over strictness)
    }
  }

  /** Zero-result analytics: best-effort publish to Redis stream consumer (market-gap detection). */
  async trackZeroResult(query: string, tenantId?: string): Promise<void> {
    await this.redis
      .publish('stream:search:zero-results', JSON.stringify({ query, tenantId: tenantId ?? null, at: new Date().toISOString() }))
      .catch(() => undefined);
  }

  async trackClickThrough(query: string, productId: string): Promise<void> {
    await this.redis
      .publish('stream:search:click', JSON.stringify({ query, productId, at: new Date().toISOString() }))
      .catch(() => undefined);
  }
}
