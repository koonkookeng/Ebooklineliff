// SSOT Phase 088 Task 4/§8 — Coupon Redlock (fail-closed distributed lock)
// Canonical: apps/backend/src/modules/promotion/services/redlock.service.ts
// - acquire fonctionnal: SET NX EX (coupon grab + checkout commit).
//   tryKey enumeration guard: bumpTry allows 5/min, fails open (UX probe,
//   never blocks calculation — only the quota lock is fail-closed).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { COUPON_TRY_LIMIT, COUPON_TRY_WINDOW_SEC, couponLockKey, couponTryKey } from '@repo/shared';

export interface RedlockPort {
  set(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
}

@Injectable()
export class RedlockService {
  constructor(private readonly redis: RedisClusterService) {}

  /** Atomic coupon grab lock (10s TTL). False on contention OR outage. */
  async acquireCoupon(code: string, ttlSec = 10): Promise<boolean> {
    try {
      const res = await this.redis.set(couponLockKey(code), `${Date.now()}`, 'NX', 'EX', ttlSec);
      return res === 'OK';
    } catch {
      return false;
    }
  }

  async releaseCoupon(code: string): Promise<void> {
    try {
      await this.redis.del(couponLockKey(code));
    } catch {
      // TTL expiry releases the lock.
    }
  }

  /** Anti-enumeration probe counter (fail-open: outage returns 1). */
  async bumpTry(userId: string): Promise<number> {
    try {
      const n = await this.redis.incr(couponTryKey(userId));
      if (n === 1) await this.redis.expire(couponTryKey(userId), COUPON_TRY_WINDOW_SEC);
      return n;
    } catch {
      return 1;
    }
  }

  tryLimit(): number {
    return COUPON_TRY_LIMIT;
  }
}
