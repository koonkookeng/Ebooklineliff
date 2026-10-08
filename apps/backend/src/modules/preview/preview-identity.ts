// SSOT Phase 051 — preview identity extractor (decorator-free, tsx-testable)
// Canonical: apps/backend/src/modules/preview/preview-identity.ts
// - Split out of ebook-preview.controller.ts on purpose: the controller file
//   carries Nest parameter decorators (@Query/@Req) which tsx/esbuild cannot
//   transform, while this helper stays runtime-importable for contract tests
//   (Phase 027–050 precedent).
// - Preview is PUBLIC: JWT identity wins, then x-user-id header, then
//   x-line-user-id, else anonymous (null userId).
import type { PreviewIdentity } from './services/preview-gatekeeper.service';

export interface PreviewHttpReq {
  user?: { id?: string };
  headers?: Record<string, string | undefined>;
}

export function previewIdentityOf(req: PreviewHttpReq): PreviewIdentity {
  return {
    userId: req.user?.id ?? req.headers?.['x-user-id'] ?? null,
    lineUserId: req.headers?.['x-line-user-id'],
  };
}
