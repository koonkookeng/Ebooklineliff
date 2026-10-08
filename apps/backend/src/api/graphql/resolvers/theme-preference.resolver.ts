// SSOT Phase 066 §5.1 — api-layer theme resolver alias (canonical mapping)
// Canonical: apps/backend/src/api/graphql/resolvers/theme-preference.resolver.ts
// (legacy src/backend/api/graphql/resolvers/theme-preference.resolver.ts)
// - Runtime lives in modules/user-preference/user-preference.resolver.ts
//   (code-first); this file re-exports it so the Phase 066 tree path
//   resolves without a duplicate field registration.
export * from '../../../modules/user-preference/user-preference.resolver';
