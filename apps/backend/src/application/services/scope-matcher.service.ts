// SSOT Phase 106 Task 3 — ScopeMatcherService (wildcard + tenant boundary)
// Canonical: apps/backend/src/application/services/scope-matcher.service.ts
// - Delegates pure matching to JwtScopePattern VO (single logic point).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { JwtScopePattern } from '../../domain/entities/jwt-scope-pattern.vo';

export interface ScopeEvaluation {
  allowed: boolean;
  missingScopes: string[];
}

@Injectable()
export class ScopeMatcherService {
  evaluate(requiredScopes: string[], userScopes: string[]): ScopeEvaluation {
    const required = requiredScopes ?? [];
    if (required.length === 0) return { allowed: true, missingScopes: [] };
    const granted = userScopes ?? [];
    const missingScopes = JwtScopePattern.missing(required, granted);
    return { allowed: missingScopes.length === 0, missingScopes };
  }

  /** Fail-closed multi-tenant boundary (§BDD Scenario 2). */
  enforceTenantBoundary(requiredScopes: string[], tenantId: string): boolean {
    if (!tenantId) return false;
    return JwtScopePattern.withinTenant(requiredScopes ?? [], tenantId);
  }
}
