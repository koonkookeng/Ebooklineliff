// SSOT Phase 130 §8.2 — GraphQL resolver rate limit (100 req/min per IP)
// Canonical: apps/backend/src/modules/security/guards/graphql-rate-limit.guard.ts
// - The Phase 127 HTTP RateLimiterGuard only sees HTTP routes; GraphQL
//   operations all arrive on POST /graphql, so a per-IP budget has to read
//   the GraphQL context (req is carried by buildGraphQLContext).
// - Fixed 60s window in Redis (incr + expire on first hit), cluster-safe key.
//   Over budget => 429 with retryAfterSec; Redis outage => fail-open so a
//   cache blip never takes the read path down (050/127 precedent).
// - Zero new deps (@nestjs/graphql + ioredis are existing workspace deps).
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { GQL_RATE_LIMIT_PER_MINUTE } from '@repo/shared';

export interface GraphqlRateLimitRedisPort {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
}

interface GqlRequest {
  ip?: string;
  headers?: Record<string, string | undefined>;
}

/** Pure verdict helper (contract-tested without Nest/Redis). */
export function evaluateGraphqlRateLimit(
  requestCount: number,
  limit: number = GQL_RATE_LIMIT_PER_MINUTE,
): { allowed: boolean; retryAfterSec: number } {
  if (requestCount <= limit) return { allowed: true, retryAfterSec: 0 };
  return { allowed: false, retryAfterSec: 60 };
}

/** Cluster-safe key: braces pin one slot per IP. */
export function graphqlRateLimitKey(ip: string): string {
  return `gql:rl:{${ip}}`;
}

@Injectable()
export class GraphqlRateLimitGuard implements CanActivate {
  constructor(private readonly redis: GraphqlRateLimitRedisPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // HTTP lanes keep their own per-route guards; this one is GraphQL-only.
    if (context.getType<'http' | 'graphql'>() !== 'graphql') return true;

    const gqlCtx = GqlExecutionContext.create(context).getContext<{ req?: GqlRequest }>();
    const req = gqlCtx?.req;
    const ip =
      req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.ip || 'unknown';
    const key = graphqlRateLimitKey(ip);
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, 60);
      const verdict = evaluateGraphqlRateLimit(count);
      if (verdict.allowed) return true;
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `GraphQL rate limit exceeded (${GQL_RATE_LIMIT_PER_MINUTE} requests/minute per IP).`,
          retryAfterSec: verdict.retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    } catch (err) {
      if (err instanceof HttpException) throw err;
      return true; // fail-open on cache outage
    }
  }
}
