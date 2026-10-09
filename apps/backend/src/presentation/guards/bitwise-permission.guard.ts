// SSOT Phase 106 §5.2 — BitwisePermissionGuard (O(1) + JTI blacklist + scope match)
// Canonical: apps/backend/src/presentation/guards/bitwise-permission.guard.ts
// (legacy src/backend/modules/security_matrix/presentation/guards/bitwise-permission.guard.ts)
// - Order: metadata-absent => allow; unauthenticated => 403; revoked JTI => 403;
//   bitwise AND => 403 on miss; scope patterns => 403 on mismatch; audit appended.
// - Redis fail-open on reads (adapter), audit failures never block the verdict.
// - Zero new deps.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BITWISE_KEY } from '../decorators/require-bitwise.decorator';
import { SCOPES_KEY } from '../decorators/require-scopes.decorator';
import { BitwiseEvaluatorService } from '../../application/services/bitwise-evaluator.service';
import { ScopeMatcherService } from '../../application/services/scope-matcher.service';
import { RedisTokenBlacklistAdapter } from '../../infrastructure/adapters/redis-token-blacklist.adapter';
import { PrismaSecurityRoleRepository } from '../../infrastructure/persistence/prisma-security-role.repository';

interface SecurityUser {
  jti?: string;
  bitmask?: string;
  scopes?: string[];
  id?: string;
  tenantId?: string;
}

@Injectable()
export class BitwisePermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly bitwise: BitwiseEvaluatorService,
    private readonly scopes: ScopeMatcherService,
    private readonly blacklist: RedisTokenBlacklistAdapter,
    private readonly audit: PrismaSecurityRoleRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredBitmask = this.reflector.getAllAndOverride<string>(BITWISE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredBitmask && (!requiredScopes || requiredScopes.length === 0)) return true;

    const request = context.switchToHttp().getRequest() as {
      user?: SecurityUser;
      ip?: string;
      headers?: Record<string, string>;
    };
    const user = request?.user;
    if (!user || !user.jti) throw new ForbiddenException('Unauthenticated security context');

    if (await this.blacklist.isRevoked(user.jti)) {
      throw new ForbiddenException('Security Token Has Been Revoked');
    }

    if (requiredBitmask) {
      const verdict = this.bitwise.evaluate(user.bitmask || '0', requiredBitmask);
      if (!verdict.allowed) {
        await this.safeAudit(user, `BITWISE_DENY:${requiredBitmask}`, requiredScopes ?? [], request);
        let hex = requiredBitmask;
        try {
          hex = BigInt(requiredBitmask).toString(16);
        } catch {
          // Keep the raw decorator value: malformed config still yields a 403, never a 500.
        }
        throw new ForbiddenException(`Access Denied: Missing Bitmask 0x${hex}`);
      }
    }

    if (requiredScopes && requiredScopes.length > 0) {
      const verdict = this.scopes.evaluate(requiredScopes, user.scopes || []);
      if (!verdict.allowed) {
        await this.safeAudit(user, 'SCOPE_DENY', requiredScopes, request);
        throw new ForbiddenException('Access Denied: Required Scope Mismatch');
      }
    }
    return true;
  }

  private async safeAudit(
    user: SecurityUser,
    action: string,
    requiredScopes: string[],
    request: { ip?: string; headers?: Record<string, string> },
  ): Promise<void> {
    try {
      await this.audit.appendAudit({
        tenantId: user.tenantId,
        userId: user.id,
        action,
        requiredScope: requiredScopes[0],
        providedScopes: user.scopes ?? [],
        granted: false,
        ipAddress: request.ip ?? 'unknown',
        userAgent: request.headers?.['user-agent'] ?? 'Unknown',
      });
    } catch {
      // Audit is append-only telemetry: never fail the request path on sink errors.
    }
  }
}
