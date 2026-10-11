// SSOT Phase 116 §3.2 — GQL finance guard (tsx-safe, decorator-free)
// Canonical: apps/backend/src/modules/analytics/resolvers/finance-guard.ts
// - Extracted from executive-analytics.resolver.ts so contract tests can
//   exercise the guard under tsx (parameter decorators do not parse under
//   tsx/esbuild — 092 precedent: decorator files are asserted statically).
// - Single logic point for the GQL finance gate; the resolver delegates here.
// - Zero new deps.
import { BadRequestException, ForbiddenException } from '@nestjs/common';

export const FINANCE_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN']);

export type LooseCtx = Record<string, unknown>;

/** Fail-closed finance gate: auth + role + tenant extraction. */
export function financeOf(ctx: LooseCtx): { tenant: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  if (!user.role || !FINANCE_ROLES.has(user.role)) throw new ForbiddenException('Executive BI requires a finance admin role');
  return { tenant: headers['x-tenant-slug'] ?? headers['x-tenant-identifier'] ?? 'default' };
}
