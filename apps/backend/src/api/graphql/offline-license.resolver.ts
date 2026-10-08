// SSOT Phase 068 §5.1 — api-layer offline-license resolver alias
// Canonical: apps/backend/src/api/graphql/offline-license.resolver.ts
// (legacy src/backend/api/graphql/offline-license.resolver.ts)
// - Runtime lives in modules/offline-license/offline-license.resolver.ts
//   (code-first); this file re-exports it so the Phase 068 tree path
//   resolves without a duplicate field registration.
export * from '../../modules/offline-license/offline-license.resolver';
