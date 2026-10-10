// SSOT Phase 109 §5.1 — Admin RBAC guard (central console gate)
// Canonical: apps/backend/src/modules/admin/user-management/guards/admin-rbac.guard.ts
// - Runs AFTER JwtAuthGuard (req.user { id, role, ... } attached).
// - Default allow-list: SUPER_ADMIN / FINANCE_ADMIN / SUPPORT_STAFF
//   (overridable per-route via @RequireAdminRoles).
// - Impersonated sessions (isImpersonated) can never pass: privilege-chain ban.
// - GQL + REST aware (reads GQL ctx req first, falls back to HTTP).
// - Zero new deps.
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ADMIN_CONSOLE_ROLES } from '@repo/shared';

export const ADMIN_ROLES_KEY = 'adminRoles';
export const RequireAdminRoles = (...roles: string[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

@Injectable()
export class AdminRbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<string[]>(ADMIN_ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [...ADMIN_CONSOLE_ROLES];

    // GQL-first with HTTP fallback (unit-test contexts may not implement
    // the full GQL host-array surface — never fail open, just read HTTP).
    let gqlReq: Record<string, unknown> | undefined;
    try {
      gqlReq = GqlExecutionContext.create(context).getContext()?.req as Record<string, unknown> | undefined;
    } catch {
      gqlReq = undefined;
    }
    const httpReq = context.switchToHttp().getRequest?.() as Record<string, unknown> | undefined;
    const req = gqlReq ?? httpReq;
    const user = req?.['user'] as { role?: string; isImpersonated?: boolean } | undefined;

    if (user?.isImpersonated === true) {
      throw new ForbiddenException('Impersonated sessions cannot access the admin console');
    }
    if (!user?.role || !required.includes(user.role)) {
      throw new ForbiddenException('Insufficient admin permission');
    }
    return true;
  }
}
