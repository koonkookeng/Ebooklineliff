// SSOT Phase 118 Gate 4 §2.1 — audit console view guard (tsx-safe, decorator-free)
// Canonical: apps/backend/src/modules/audit-log/presentation/audit-view.ts
// - Extracted from audit-log.resolver.ts so contract tests can exercise the
//   Gate-4 masking behavior under tsx (parameter decorators do not parse
//   under tsx/esbuild — 092/116 precedent: decorator files are asserted
//   statically). Single logic point; the resolver delegates here.
// - Zero new deps.
import { ForbiddenException } from '@nestjs/common';

export type LooseCtx = Record<string, unknown>;

export const AUDIT_READ_ROLES = new Set([
  'SUPER_ADMIN',
  'FINANCE_ADMIN',
  'CONTENT_MODERATOR',
  'SUPPORT_STAFF',
]);

export const HASH_REVEAL_ROLES = new Set(['SUPER_ADMIN', 'FINANCE_ADMIN']);

export const MASKED_HASH = '••••';

export function actorOf(ctx: LooseCtx): { id: string; role: string; email: string; ip: string; ua: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string; role?: string; email?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  if (!user.id || !user.role) throw new ForbiddenException('Audit console requires an authenticated admin');
  const fwd = headers['x-forwarded-for'] ?? '';
  return {
    id: user.id,
    role: user.role,
    email: user.email ?? 'unknown',
    ip: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0'),
    ua: headers['user-agent'] ?? 'unknown',
  };
}

export function assertCanRead(role: string | undefined): void {
  if (!role || !AUDIT_READ_ROLES.has(role)) throw new ForbiddenException('Audit console requires an admin role');
}

/** Hash material only for auditor roles (Gate 4). */
export function canRevealHashes(role: string): boolean {
  return HASH_REVEAL_ROLES.has(role);
}

export function maskRowHashes(
  row: { previousHash: string; currentHash: string },
  revealHashes: boolean,
): { previousHash: string; currentHash: string } {
  return {
    previousHash: revealHashes ? row.previousHash : MASKED_HASH,
    currentHash: revealHashes ? row.currentHash : MASKED_HASH,
  };
}
