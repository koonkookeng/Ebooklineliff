// SSOT Phase 071 §5.1 — Backend Tenant Context Guard
// Canonical: apps/backend/src/common/guards/tenant.guard.ts
// (legacy src/backend/common/guards/tenant.guard.ts)
// - Enforces multi-tenant isolation: every guarded request must carry
//   X-Tenant-ID (resolved tenant UUID; the Edge middleware + LIFF client set
//   it from subdomain / custom domain / ?tenant= — see tenant-resolver).
// - Verifies ACTIVE status via the Redis edge key `tenant:status:{id}`
//   (fail-closed: unknown/error status -> 401; prevents suspended-tenant
//   access and cross-tenant leakage per Gate 4).
// - Attaches `req.tenantId` for downstream handlers (Zero Redundant Code:
//   resolvers/services must read req.tenantId, never re-resolve).
// - Dual transport: HTTP (Fastify) + GraphQL context req. Zero new deps.
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { tenantStatusKey } from '@repo/shared';

function readTenantId(req: Record<string, unknown>): string | null {
  const headers = (req['headers'] ?? {}) as Record<string, string | string[] | undefined>;
  const raw = headers['x-tenant-id'] ?? headers['X-Tenant-ID'];
  if (Array.isArray(raw)) return raw[0]?.trim() || null;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly redis: RedisClusterService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gql = GqlExecutionContext.create(context);
    const gqlReq = gql.getContext()?.req as Record<string, unknown> | undefined;
    const httpReq = context.switchToHttp().getRequest?.() as Record<string, unknown> | undefined;
    const req = gqlReq ?? httpReq;
    if (!req) throw new UnauthorizedException('Missing request context.');

    const tenantId = readTenantId(req);
    if (!tenantId) {
      throw new UnauthorizedException('Missing X-Tenant-ID header context.');
    }

    let status: string | null = null;
    try {
      status = await this.redis.get(tenantStatusKey(tenantId));
    } catch {
      throw new UnauthorizedException('Tenant status unavailable.');
    }
    if (status !== 'ACTIVE') {
      throw new UnauthorizedException('Tenant is inactive or suspended.');
    }

    (req as Record<string, unknown>)['tenantId'] = tenantId;
    return true;
  }
}
