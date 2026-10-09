// SSOT Phase 090 — Legacy GQL alias (canonical lives in modules/group-buying)
// Canonical: apps/backend/src/api/graphql/resolvers/group-buying.resolver.ts
// - Re-exports the canonical resolver so legacy imports keep working.
export { GroupBuyingResolver } from '../../../modules/group-buying/api/graphql/group-buying.resolver';
