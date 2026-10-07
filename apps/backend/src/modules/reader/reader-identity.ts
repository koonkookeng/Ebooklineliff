// SSOT Phase 040 — Reader identity extractor (decorator-free, tsx-testable)
// Canonical: apps/backend/src/modules/reader/reader-identity.ts
// - Split out of reader.resolver.ts on purpose: the resolver file carries Nest
//   parameter decorators (@Args/@Context) which tsx/esbuild cannot transform,
//   while this helper stays runtime-importable for contract tests
//   (Phase 027–039 precedent).
import { BadRequestException } from '@nestjs/common';

export interface ReaderGqlContext {
  req?: { user?: { id?: string; tenantId?: string } };
}

/** JWT identity wins; tenant falls back to 'default'; anonymous rejected. */
export function resolveReaderIdentity(ctx: ReaderGqlContext | undefined): { userId: string; tenantId: string } {
  const user = ctx?.req?.user;
  if (!user?.id) throw new BadRequestException('Missing session identity');
  return { userId: user.id, tenantId: user.tenantId ?? 'default' };
}
