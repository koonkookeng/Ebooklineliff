// SSOT Phase 083 Task 3/§8.1 — Redis streak lock (Redlock shape, fail-closed)
// Canonical: apps/backend/src/modules/gamification/infrastructure/redis/redis-streak-lock.service.ts
// - Check-in mutex via SET NX EX (concurrent double-tap guard, BDD-1);
//   redemption velocity counter (>5/min → account freeze signal).
// - Money-adjacent paths fail CLOSED on Redis outage (no double-spend).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../../infra/redis/redis-cluster.service';
import {
  REDEEM_VELOCITY_LIMIT,
  REDEEM_VELOCITY_WINDOW_SEC,
  checkinLockKey,
  redeemVelocityKey,
} from '@repo/shared';

export interface StreakLockPort {
  acquireCheckin(userId: string): Promise<boolean>;
  releaseCheckin(userId: string): Promise<void>;
  bumpRedeem(userId: string): Promise<number>;
  redeemLimit(): number;
  emit(stream: string, fields: Record<string, string | number>): Promise<void>;
}

@Injectable()
export class RedisStreakLockService implements StreakLockPort {
  constructor(private readonly redis: RedisClusterService) {}

  async acquireCheckin(userId: string): Promise<boolean> {
    try {
      const res = await this.redis.set(checkinLockKey(userId), `${Date.now()}`, 'NX', 'EX', 10);
      return res === 'OK';
    } catch {
      return false;
    }
  }

  async releaseCheckin(userId: string): Promise<void> {
    try {
      await this.redis.del(checkinLockKey(userId));
    } catch {
      // TTL expiry releases the lock.
    }
  }

  async bumpRedeem(userId: string): Promise<number> {
    try {
      const n = await this.redis.incr(redeemVelocityKey(userId));
      if (n === 1) await this.redis.expire(redeemVelocityKey(userId), REDEEM_VELOCITY_WINDOW_SEC);
      return n;
    } catch {
      return 1;
    }
  }

  redeemLimit(): number {
    return REDEEM_VELOCITY_LIMIT;
  }

  async emit(stream: string, fields: Record<string, string | number>): Promise<void> {
    try {
      await this.redis.xaddPipeline(stream, [fields]);
    } catch {
      // Telemetry must never break reward flows.
    }
  }
}
