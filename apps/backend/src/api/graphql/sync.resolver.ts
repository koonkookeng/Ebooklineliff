// SSOT Phase 070 §3.2 — api-layer sync resolver alias (canonical mapping)
// Canonical: apps/backend/src/api/graphql/sync.resolver.ts
// (legacy src/backend/api/graphql/sync.resolver.ts)
// - Runtime lives in modules/sync/cross-device.resolver.ts (code-first);
//   this file re-exports it so the Phase 070 tree path resolves without a
//   duplicate field registration.
export * from '../../modules/sync/cross-device.resolver';
