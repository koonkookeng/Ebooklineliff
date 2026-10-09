// SSOT Phase 106 §5.1 — JwtScopePattern value object (wildcard + tenant boundary)
// Canonical: apps/backend/src/domain/entities/jwt-scope-pattern.vo.ts
// (legacy src/backend/modules/security_matrix/domain/entities/jwt-scope-pattern.vo.ts)
// - Single source for scope matching; guards + services delegate here.
// - Zero new deps.
import { isTenantScopeAllowed, matchScopePattern, tenantOfScope } from '@repo/shared';

export class JwtScopePattern {
  private constructor(private readonly pattern: string) {}

  static from(pattern: string): JwtScopePattern {
    if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 200) {
      throw new Error('Invalid scope pattern');
    }
    return new JwtScopePattern(pattern);
  }

  toString(): string {
    return this.pattern;
  }

  tenantId(): string | null {
    return tenantOfScope(this.pattern);
  }

  /** True when this stored pattern authorizes the required scope. */
  covers(requiredScope: string): boolean {
    return matchScopePattern(requiredScope, [this.pattern]);
  }

  /** True when every required scope is covered by at least one granted pattern. */
  static satisfiesAll(required: string[], granted: string[]): boolean {
    return required.every((req) => matchScopePattern(req, granted));
  }

  /** Missing required scopes (for PermissionEvaluationResult.missingScopes). */
  static missing(required: string[], granted: string[]): string[] {
    return required.filter((req) => !matchScopePattern(req, granted));
  }

  /** Fail-closed tenant boundary: all required scopes must belong to tenantId. */
  static withinTenant(required: string[], tenantId: string): boolean {
    return required.every((scope) => isTenantScopeAllowed(scope, tenantId) && JwtScopePattern.tenantMatches(scope, tenantId));
  }

  private static tenantMatches(scope: string, tenantId: string): boolean {
    if (scope === '*') return true;
    const tenant = tenantOfScope(scope);
    return tenant === tenantId || tenant === '*';
  }
}
