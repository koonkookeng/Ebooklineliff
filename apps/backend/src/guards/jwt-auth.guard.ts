// SSOT Phase 005 §5.1/§9 — Global Fastify JWT guard (single auth checkpoint; no per-controller checks)
// Canonical: apps/backend/src/guards/jwt-auth.guard.ts (legacy src/backend/guards/jwt-auth.guard.ts)
// Accepts Bearer header or __Host- secure cookie; attaches req.user { id, role, tenantId, sessionId }.
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtStrategy } from '../modules/auth/strategies/jwt.strategy';

function extractToken(req: Record<string, unknown>): string | null {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  const auth = headers['authorization'] ?? headers['Authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ') && auth.length > 12) {
    return auth.slice('Bearer '.length);
  }
  const cookies = (req['cookies'] ?? {}) as Record<string, string | undefined>;
  const fromCookie =
    cookies['__Host-next-auth.session-token'] ?? cookies['__Host-session-token'];
  if (typeof fromCookie === 'string' && fromCookie.length > 10) return fromCookie;
  return null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly strategy: JwtStrategy) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gql = GqlExecutionContext.create(context);
    const gqlReq = gql.getContext()?.req as Record<string, unknown> | undefined;
    const httpReq = context.switchToHttp().getRequest?.() as Record<string, unknown> | undefined;
    const req = gqlReq ?? httpReq;
    if (!req) throw new UnauthorizedException('Missing request context');
    const token = extractToken(req);
    if (!token) throw new UnauthorizedException('Missing session token');
    const payload = await this.strategy.validate(token);
    (req as Record<string, unknown>)['user'] = {
      id: payload.sub,
      role: payload.role,
      tenantId: payload.tenantId,
      sessionId: payload.sessionId,
      lineUserId: payload.lineUserId ?? null,
      email: payload.email ?? null,
    };
    return true;
  }
}
