// SSOT Phase 077 §3.2 — legacy alias (canonical lives in modules/logistics)
// Canonical: apps/backend/src/api/graphql/logistics.resolver.ts
// Re-export only (076 precedent); registered once via LogisticsModule.
export { LogisticsResolver } from '../../modules/logistics/resolvers/logistics.resolver';
