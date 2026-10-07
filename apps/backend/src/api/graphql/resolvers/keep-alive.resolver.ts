// SSOT Phase 031 §5.1 — legacy alias (canonical lives in modules/keep-alive)
// Canonical: apps/backend/src/api/graphql/resolvers/keep-alive.resolver.ts
// (legacy src/backend/api/graphql/resolvers/keep-alive.resolver.ts)
// Re-export only (Phase 026–030 precedent); registered once via KeepAliveModule.
export { KeepAliveResolver } from '../../../modules/keep-alive/keep-alive.resolver';
