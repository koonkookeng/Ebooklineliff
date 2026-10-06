// SSOT Phase 025 Task 3 — Fastify resolver REST controller (Redis rate-limited)
// Canonical: apps/backend/src/modules/resolver/infrastructure/controllers/fastify-resolver.controller.ts
// (legacy src/backend/modules/resolver/infrastructure/controllers/fastify-resolver.controller.ts)
// - GET  /api/v1/resolver/resolve?code=   → ResolveDeepLinkUseCase (public; §8.1
//   100 req/min/IP fixed-window via Redis get/setex, fail-open on Redis outage).
// - POST /api/v1/resolver/links           → CreateShortLinkUseCase (Zod-gated).
// - GET  /api/v1/resolver/verify-state?state= → verifyAndDecryptState (401 tampered).
// - Idempotent reads: no duplicate-click dedupe here; counters are additive by design.
import { BadRequestException, Controller, Get, Post, Body, Query, Req } from '@nestjs/common';
import { ResolveDeepLinkUseCase } from '../../application/use-cases/resolve-deep-link.usecase';
import { CreateShortLinkUseCase } from '../../application/use-cases/create-short-link.usecase';
import { DeepLinkResolverService } from '../../application/services/deep-link-resolver.service';
import { RedisClusterService } from '../../../../infra/redis/redis-cluster.service';
import { CreateShortLinkInputSchema, RESOLVER_RATE_LIMIT_PER_MIN } from '@repo/shared';

function clientIp(req: { ip?: string; headers?: Record<string, string | string[] | undefined> }): string {
  const fwd = req.headers?.['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
  return (first ?? req.ip ?? 'unknown').trim();
}

@Controller('api/v1/resolver')
export class FastifyResolverController {
  constructor(
    private readonly resolve: ResolveDeepLinkUseCase,
    private readonly create: CreateShortLinkUseCase,
    private readonly core: DeepLinkResolverService,
    private readonly redis: RedisClusterService,
  ) {}

  private async checkRateLimit(ip: string): Promise<void> {
    const key = `resolver:ratelimit:${ip}`;
    try {
      const cur = await this.redis.get(key).catch(() => null);
      const count = cur ? Number.parseInt(cur, 10) || 0 : 0;
      if (count >= RESOLVER_RATE_LIMIT_PER_MIN) {
        throw new BadRequestException('Rate limit exceeded. Try again in a minute.');
      }
      await this.redis.setex(key, 60, String(count + 1)).catch(() => undefined);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Fail-open: resolver stays available during Redis outage (logged by redis svc).
    }
  }

  @Get('resolve')
  async resolveCode(
    @Query('code') code: string,
    @Req() req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ) {
    if (!code) throw new BadRequestException('Missing short code');
    const uaHeader = req.headers?.['user-agent'];
    const userAgent = Array.isArray(uaHeader) ? uaHeader[0] ?? '' : uaHeader ?? '';
    const refererHeader = req.headers?.['referer'];
    const referer = Array.isArray(refererHeader) ? refererHeader[0] : refererHeader;
    await this.checkRateLimit(clientIp(req));
    return this.resolve.execute(code, userAgent, clientIp(req), referer);
  }

  @Post('links')
  async createLink(@Body() body: unknown) {
    const parsed = CreateShortLinkInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid short-link input');
    return this.create.execute(parsed.data);
  }

  @Get('verify-state')
  verifyState(@Query('state') state: string) {
    if (!state) throw new BadRequestException('Missing state payload');
    return this.core.verifyAndDecryptState(state);
  }
}
