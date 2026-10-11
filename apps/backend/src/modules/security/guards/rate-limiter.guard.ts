// SSOT Phase 127 §3.1/§8.1 — Redis edge rate-limiting guard (OWASP A07 brute-force)
// Canonical: apps/backend/src/modules/security/guards/rate-limiter.guard.ts
// (legacy src/backend/modules/security/guards/rate-limiter.guard.ts)
// - Fixed-window counter per SecurityRateLimitRule: over-limit => 429 with
//   retryAfterSec; attacker IPs already on the 24h block list => 403.
// - Fail-open on Redis outage (availability first; 050/122 precedent).
// - Pure evaluateRateLimit exported for contract tests.
// - Zero new deps.
import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  ATTACKER_BLOCK_TTL_SEC,
  attackerBlockKey,
  securityRateLimitKey,
  type SecurityRateLimitRule,
} from '@repo/shared';

export interface RateLimitRedisPort {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
}

export function evaluateRateLimit(
  requestCount: number,
  rule: SecurityRateLimitRule,
): { allowed: boolean; retryAfterSec: number } {
  if (requestCount <= rule.maxRequestsPerMinute) return { allowed: true, retryAfterSec: 0 };
  return { allowed: false, retryAfterSec: rule.blockDurationSeconds };
}

@Injectable()
export class RateLimiterGuard implements CanActivate {
  constructor(
    private readonly redis: RateLimitRedisPort,
    private readonly rule: SecurityRateLimitRule = {
      endpointPattern: 'global',
      maxRequestsPerMinute: 30,
      blockDurationSeconds: 60,
    },
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest() as {
      ip?: string;
      route?: { path?: string };
      url?: string;
      headers?: Record<string, string | undefined>;
    };
    const clientIp =
      req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    try {
      const blocked = await this.redis.get(attackerBlockKey(clientIp));
      if (blocked) {
        throw new ForbiddenException('IP temporarily blocked (security policy).');
      }
      const count = await this.redis.incr(securityRateLimitKey(this.rule.endpointPattern, clientIp));
      if (count === 1) await this.redis.expire(securityRateLimitKey(this.rule.endpointPattern, clientIp), 60);
      const verdict = evaluateRateLimit(count, this.rule);
      if (verdict.allowed) return true;
      await this.redis.expire(securityRateLimitKey(this.rule.endpointPattern, clientIp), 60).catch(() => undefined);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded. Slow down and retry.',
          retryAfterSec: verdict.retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    } catch (err) {
      if (err instanceof HttpException) throw err;
      return true; // fail-open: never hard-down the shop on cache outage
    }
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const RateLimiterGuardGuard = RateLimiterGuard;

export { ATTACKER_BLOCK_TTL_SEC };
