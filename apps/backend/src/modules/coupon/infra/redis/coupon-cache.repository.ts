// SSOT Phase 117 Task 3 §5.1 — coupon Redis seam (meta/quota/reservation)
// Canonical: apps/backend/src/modules/coupon/infra/redis/coupon-cache.repository.ts
// (legacy src/backend/modules/coupon/infra/redis/coupon-cache.repository.ts)
// - Meta cache 300s (spec §5.2 <5ms lane) + atomic quota Lua (decrement with
//   floor; double-spend rollback at the Redis layer, §10) + 15-min
//   reservation holds (Redlock-style setnx) + per-user claim guard +
//   10/min/IP validate shield. All fail-open except the reservation hold
//   itself (a hold IS the safety signal).
// - DB conditional increments stay the hard guard (prisma repo); Redis is
//   the fast path. Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import {
  COUPON_META_CACHE_TTL_SEC,
  COUPON_RESERVATION_TTL_SEC,
  COUPON_VALIDATE_RATE_LIMIT,
  COUPON_VALIDATE_RATE_WINDOW_SEC,
} from '@repo/shared';
import { RedisClusterService } from '../../../../infra/redis/redis-cluster.service';

/** Atomic quota decrement with floor: returns remaining, or -1 when empty. */
export const QUOTA_DECREMENT_LUA = [
  'local left = tonumber(redis.call("GET", KEYS[1]) or "-1")',
  'if left < 0 then return -1 end',
  'if left <= 0 then return -1 end',
  'return redis.call("DECRBY", KEYS[1], ARGV[1])',
].join('\n');

/** Token-checked release (only the holder releases the reservation). */
export const RESERVATION_RELEASE_LUA = [
  'if redis.call("GET", KEYS[1]) == ARGV[1] then',
  '  return redis.call("DEL", KEYS[1])',
  'else',
  '  return 0',
  'end',
].join('\n');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

@Injectable()
export class CouponCacheRepository {
  private readonly logger = new Logger(CouponCacheRepository.name);

  constructor(private readonly redis: RedisClusterService) {}

  async metaGet<T>(code: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(`coupon:meta:${code}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async metaSet(code: string, meta: unknown): Promise<void> {
    try {
      await this.redis.setex(`coupon:meta:${code}`, COUPON_META_CACHE_TTL_SEC, JSON.stringify(meta));
    } catch {
      // Cache write is best-effort.
    }
  }

  /** Best-effort quota mirror decrement (floor-guarded; DB is source of truth). */
  async quotaDecrement(quotaKey: string, by = 1): Promise<number> {
    try {
      const out = await this.redis.evalLua(QUOTA_DECREMENT_LUA, [quotaKey], [by]);
      return typeof out === 'number' ? out : -1;
    } catch {
      return -1;
    }
  }

  /** Seed the quota mirror from the DB lane (300s TTL, best-effort). */
  async quotaSeed(quotaKey: string, left: number, ttlSeconds = COUPON_META_CACHE_TTL_SEC): Promise<void> {
    try {
      await this.redis.setex(quotaKey, ttlSeconds, String(Math.max(0, left)));
    } catch {
      // Cache write is best-effort.
    }
  }

  /** Reservation hold; [locked, token]. TTL defaults to 15 min. */
  async reserveHold(reservationKey: string, token: string, ttlSec = COUPON_RESERVATION_TTL_SEC): Promise<boolean> {
    try {
      return await this.redis.setnx(reservationKey, token, ttlSec);
    } catch (err) {
      this.logger.warn(`Reservation hold fail-open: ${(err as Error).message}`);
      return true;
    }
  }

  async releaseHold(reservationKey: string, token: string): Promise<void> {
    try {
      await this.redis.evalLua(RESERVATION_RELEASE_LUA, [reservationKey], [token]);
    } catch {
      // Best-effort release (TTL bounds the blast radius).
    }
  }

  /** One-time-claim pre-guard (exact ledger in UserCouponClaim stays canonical). */
  async claimGuard(userKey: string): Promise<boolean> {
    try {
      return await this.redis.setnx(userKey, '1', COUPON_RESERVATION_TTL_SEC);
    } catch {
      return true;
    }
  }

  /** 10/min/IP edge shield; true when over the limit. */
  async tryRateLimited(tryKey: string): Promise<boolean> {
    try {
      const count = await this.redis.incrby(tryKey, 1);
      if (count === 1) await this.redis.expire(tryKey, COUPON_VALIDATE_RATE_WINDOW_SEC);
      return count > COUPON_VALIDATE_RATE_LIMIT;
    } catch {
      return false;
    }
  }

  async publish(event: string, fields: Record<string, string | number>): Promise<void> {
    try {
      const { CAMPAIGN_EVENT_STREAM } = await import('@repo/shared');
      await this.redis.xaddPipeline(CAMPAIGN_EVENT_STREAM, [{ event, ...fields, at: Date.now() }]);
    } catch {
      // Telemetry never breaks coupon flows.
    }
  }
}

/** Retry a lock acquisition 3x with backoff (flash-sale contention lane). */
export async function withCouponLock<T>(repo: Pick<CouponCacheRepository, 'reserveHold' | 'releaseHold'>, key: string, token: string, fn: () => Promise<T>): Promise<T> {
  const delays = [50, 150, 350];
  for (let attempt = 0; ; attempt++) {
    if (await repo.reserveHold(key, token)) {
      try {
        return await fn();
      } finally {
        await repo.releaseHold(key, token);
      }
    }
    if (attempt >= delays.length) throw new Error('COUPON_CONTENTION');
    await sleep(delays[attempt] ?? 350);
  }
}
