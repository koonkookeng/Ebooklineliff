// SSOT Phase 106 Task 4 — RedisTokenBlacklistAdapter (JTI revocation <1s edge fan-out)
// Canonical: apps/backend/src/infrastructure/adapters/redis-token-blacklist.adapter.ts
// - SET NX EX for idempotent revoke; GET for <0.2ms guard check; DEL for rotation.
// - Fail-open reads (Redis down => allow + log) match Phase 050 precedent; writes fail-closed.
// - Zero new deps (RedisClusterService is the shared pool).
import { Injectable, Logger } from '@nestjs/common';
import { blacklistJtiKey } from '@repo/shared';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';

@Injectable()
export class RedisTokenBlacklistAdapter {
  private readonly logger = new Logger(RedisTokenBlacklistAdapter.name);

  constructor(private readonly redis: RedisClusterService) {}

  async revoke(jti: string, ttlSeconds: number): Promise<boolean> {
    const ok = await this.redis.setnx(blacklistJtiKey(jti), '1', Math.max(1, ttlSeconds));
    return ok;
  }

  async isRevoked(jti: string): Promise<boolean> {
    try {
      const hit = await this.redis.get(blacklistJtiKey(jti));
      return hit !== null;
    } catch (e) {
      this.logger.warn(`blacklist read fail-open for ${jti}: ${(e as Error).message}`);
      return false;
    }
  }

  async release(jti: string): Promise<void> {
    await this.redis.del(blacklistJtiKey(jti));
  }
}
