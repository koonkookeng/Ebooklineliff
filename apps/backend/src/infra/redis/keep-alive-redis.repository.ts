// SSOT Phase 031 §5.1 — Keep-alive Redis session cache engine (15min TTL)
// Canonical: apps/backend/src/infra/redis/keep-alive-redis.repository.ts
// (legacy src/backend/infra/redis/keep-alive-redis.repository.ts)
// - Key keepalive:{userId}:{tenantId}:{viewportType}, TTL 900s (checkout
//   restore window, BDD Scenario 3); fail-open reads (null) degrade to PG.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from './redis-cluster.service';
import { KEEPALIVE_TTL_SEC, keepAliveRedisKey } from '@repo/shared';

@Injectable()
export class KeepAliveRedisRepository {
  constructor(private readonly redis: RedisClusterService) {}

  key(userId: string, tenantId: string, viewportType: string): string {
    return keepAliveRedisKey(userId, tenantId, viewportType);
  }

  async get(userId: string, tenantId: string, viewportType: string): Promise<string | null> {
    return this.redis.get(this.key(userId, tenantId, viewportType)).catch(() => null);
  }

  async set(userId: string, tenantId: string, viewportType: string, stateJson: string): Promise<void> {
    await this.redis.setex(this.key(userId, tenantId, viewportType), KEEPALIVE_TTL_SEC, stateJson).catch(() => undefined);
  }

  async del(userId: string, tenantId: string, viewportType: string): Promise<void> {
    await this.redis.del(this.key(userId, tenantId, viewportType)).catch(() => undefined);
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.redis.publish(channel, message).catch(() => undefined);
  }
}
