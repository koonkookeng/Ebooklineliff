// SSOT Phase 052 §1.2 — api-layer resolver alias (no logic duplication).
// Canonical: apps/backend/src/api/graphql/analytics.resolver.ts
// (legacy src/backend/api/graphql/analytics.resolver.ts)
// - Single implementation lives in modules/analytics/resolvers.
export { AnalyticsResolver } from '../../modules/analytics/resolvers/analytics.resolver';
