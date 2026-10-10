// SSOT Phase 118 §5.1 — audit context guard (actor attachment, fail-closed)
// Canonical: apps/backend/src/modules/auth/guards/audit-context.guard.ts
// (legacy src/backend/modules/auth/guards/audit-context.guard.ts)
// - Passes only authenticated admin-role requests and stamps a normalized
//   audit actor (id/role/email/ip/ua) onto the request for downstream
//   interceptors and services. Non-admins are rejected (fail-closed).
// - Zero new deps.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AUDIT_ROLES } from '../../audit-log/domain/audit-log.entity';

export const AUDIT_ACTOR_KEY = 'auditActor';

type LooseReq = Record<string, unknown>;

@Injectable()
export class AuditContextGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<LooseReq>();
    const user = (req['user'] as { id?: string; role?: string; email?: string } | undefined) ?? {};
    if (!user.id) throw new UnauthorizedException('Missing authentication');
    if (!user.role || !(AUDIT_ROLES as readonly string[]).includes(user.role)) {
      throw new ForbiddenException('Audit context requires an admin role');
    }
    const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
    const fwd = headers['x-forwarded-for'] ?? '';
    req[AUDIT_ACTOR_KEY] = {
      id: user.id,
      role: user.role,
      email: user.email ?? 'unknown',
      ipAddress: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0'),
      userAgent: headers['user-agent'] ?? 'unknown',
    };
    return true;
  }
}
