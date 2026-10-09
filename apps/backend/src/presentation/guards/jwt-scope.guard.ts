// SSOT Phase 106 Task 3 — JwtScopeGuard (strict tenant boundary + JTI blacklist)
// Canonical: apps/backend/src/presentation/guards/jwt-scope.guard.ts
// - Rejects cross-tenant scope use with 403 (BDD Scenario 2) before pattern match.
// - Zero new deps.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SCOPES_KEY } from '../decorators/require-scopes.decorator';
import { ScopeMatcherService } from '../../application/services/scope-matcher.service';
import { RedisTokenBlacklistAdapter } from '../../infrastructure/adapters/redis-token-blacklist.adapter';
import { JwtScopePattern } from '../../domain/entities/jwt-scope-pattern.vo';

interface ScopeUser {
  jti?: string;
  scopes?: string[];
  tenantId?: string;
  id?: string;
}

@Injectable()
export class JwtScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly scopes: ScopeMatcherService,
    private readonly blacklist: RedisTokenBlacklistAdapter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredScopes || requiredScopes.length === 0) return true;

    const request = context.switchToHttp().getRequest() as { user?: ScopeUser };
    const user = request?.user;
    if (!user || !user.jti) throw new ForbiddenException('Unauthenticated security context');
    if (await this.blacklist.isRevoked(user.jti)) {
      throw new ForbiddenException('Security Token Has Been Revoked');
    }
    const tenantId = user.tenantId ?? '';
    if (!JwtScopePattern.withinTenant(requiredScopes, tenantId)) {
      throw new ForbiddenException('Access Denied: Tenant Boundary Mismatch');
    }
    const verdict = this.scopes.evaluate(requiredScopes, user.scopes || []);
    if (!verdict.allowed) throw new ForbiddenException('Access Denied: Required Scope Mismatch');
    return true;
  }
}
