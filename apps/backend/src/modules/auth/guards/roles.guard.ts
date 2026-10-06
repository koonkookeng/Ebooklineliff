// SSOT Phase 005 §5.1 — RBAC granular permission guard (use after JwtAuthGuard)
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest?.() as
      | { user?: { role?: string } }
      | undefined;
    const role = req?.user?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException('Insufficient role permission');
    }
    return true;
  }
}
