// SSOT Phase 080 Task 6 — Redis edge cache for click attribution sessions
// Canonical: apps/backend/src/modules/share/infrastructure/share-redis.cache.ts
// - Attribution sessions: SETEX 30-day TTL (BDD-2); first-seen marks a new
//   session (isNewSession) for CTR/viral analytics.
// - Generation rate limit: 10/min per user (§8.1) via incr + expire window.
// - Click/share streams fan-out best-effort (Gate 8) — never fail the caller.
// - Port-based (cache port) for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  FLEX_REF_TOKEN_TTL_SEC,
  FLEX_GENERATE_RATE_WINDOW_SEC,
  flexSessionKey,
  flexGenerateRateKey,
} from '@repo/shared';

export interface ShareCachePort {
  sessionSeen(refToken: string, visitorKey: string): Promise<boolean>;
  rememberSession(refToken: string, visitorKey: string): Promise<void>;
  bumpGenerate(userId: string): Promise<number>;
  emit(stream: string, fields: Record<string, string | number>): Promise<void>;
}

@Injectable()
export class ShareRedisCache implements ShareCachePort {
  constructor(private readonly redis: RedisClusterService) {}

  async sessionSeen(refToken: string, visitorKey: string): Promise<boolean> {
    try {
      return (await this.redis.get(flexSessionKey(refToken, visitorKey))) != null;
    } catch {
      return false;
    }
  }

  async rememberSession(refToken: string, visitorKey: string): Promise<void> {
    try {
      await this.redis.setex(flexSessionKey(refToken, visitorKey), FLEX_REF_TOKEN_TTL_SEC, '1');
    } catch {
      // Best-effort attribution cache.
    }
  }

  async bumpGenerate(userId: string): Promise<number> {
    try {
      const n = await this.redis.incr(flexGenerateRateKey(userId));
      if (n === 1) await this.redis.expire(flexGenerateRateKey(userId), FLEX_GENERATE_RATE_WINDOW_SEC);
      return n;
    } catch {
      return 1;
    }
  }

  async emit(stream: string, fields: Record<string, string | number>): Promise<void> {
    try {
      await this.redis.xaddPipeline(stream, [fields]);
    } catch {
      // Telemetry must never break the share flow.
    }
  }
}
