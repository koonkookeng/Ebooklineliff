// SSOT Phase 131 §5.4 — Redis fixed-window rate limiter for unauthenticated auth endpoints
// Canonical: apps/backend/src/modules/auth/services/auth-rate-limit.service.ts
//
// Zero new dependencies. Fail-open on Redis failure: an outage of the cache must not
// lock every user out of login, while the audit log still records the event.
import { HttpException, HttpStatus, Injectable, Optional } from '@nestjs/common';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';

export interface RateLimitRule {
  limit: number;
  windowSec: number;
}

export const AUTH_RATE_LIMITS = {
  start: { limit: 30, windowSec: 60 },
  callback: { limit: 30, windowSec: 60 },
  emailRequest: { limit: 5, windowSec: 60 },
  emailVerify: { limit: 20, windowSec: 60 },
} as const satisfies Record<string, RateLimitRule>;

@Injectable()
export class AuthRateLimitService {
  constructor(@Optional() private readonly redis?: RedisClusterService) {}

  /** Returns true when the caller is still inside the allowance. */
  async consume(bucket: string, subject: string, rule: RateLimitRule): Promise<boolean> {
    if (!this.redis) return true;
    const window = Math.floor(Date.now() / (rule.windowSec * 1000));
    const key = `auth:rl:${bucket}:${subject}:${window}`;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, rule.windowSec);
      return count <= rule.limit;
    } catch {
      return true; // fail-open
    }
  }

  /** Throws HTTP 429 when the allowance is exhausted. */
  async assertWithinLimit(bucket: string, subject: string, rule: RateLimitRule): Promise<void> {
    const allowed = await this.consume(bucket, subject, rule);
    if (!allowed) {
      throw new HttpException('Too many authentication attempts', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
