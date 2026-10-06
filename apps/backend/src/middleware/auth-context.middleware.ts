// SSOT Phase 005 §9 — Fastify auth-context middleware (single checkpoint companion to JwtAuthGuard)
// Propagates tenant context downstream; tenant resolved from verified user or header in <10ms
// (no I/O on the hot path; branding itself is applied at the Next.js edge middleware).
import { Injectable, NestMiddleware } from '@nestjs/common';

interface AuthContextRequest {
  user?: { id?: string; role?: string; tenantId?: string };
  headers: Record<string, string | string[] | undefined>;
  tenantId?: string;
}

@Injectable()
export class AuthContextMiddleware implements NestMiddleware {
  use(req: AuthContextRequest, _res: unknown, next: () => void) {
    const headerTenant = req.headers['x-tenant-id'];
    const tenant =
      req.user?.tenantId ??
      (Array.isArray(headerTenant) ? headerTenant[0] : headerTenant) ??
      'default';
    req.tenantId = tenant;
    next();
  }
}
