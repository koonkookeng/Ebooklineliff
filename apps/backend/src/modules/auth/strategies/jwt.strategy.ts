// SSOT Phase 005 §5.1/§10.2 — Passport-style JWT strategy with Redis whitelist + PG fallback
// Canonical: apps/backend/src/modules/auth/strategies/jwt.strategy.ts
// (legacy src/backend/strategies/jwt.strategy.ts)
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtPayloadSchema, type JwtPayload } from '@repo/shared';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { TokenService } from '../services/token.service';

@Injectable()
export class JwtStrategy {
  constructor(
    private readonly tokens: TokenService,
    private readonly redis: RedisClusterService,
    private readonly prisma: PrismaService,
  ) {}

  async validate(token: string): Promise<JwtPayload> {
    let payload: JwtPayload;
    try {
      payload = this.tokens.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
    const zod = JwtPayloadSchema.safeParse(payload);
    if (!zod.success) throw new UnauthorizedException('Invalid session payload');

    // Redis whitelist (<1ms); on Redis failure fall back to PostgreSQL (self-healing §10.2)
    try {
      const cached = await this.redis.get(`session:${payload.sessionId}`);
      if (cached) return zod.data;
    } catch {
      // fall through to PG
    }
    const session = await this.prisma.session
      .findUnique({ where: { id: payload.sessionId } })
      .catch(() => null);
    if (!session || session.isRevoked || session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session revoked or expired');
    }
    // Re-build Redis cache when connection is back (self-healing)
    await this.redis
      .setex(
        `session:${session.id}`,
        900,
        JSON.stringify({ userId: session.userId, role: payload.role, tenantId: payload.tenantId }),
      )
      .catch(() => undefined);
    return zod.data;
  }
}
