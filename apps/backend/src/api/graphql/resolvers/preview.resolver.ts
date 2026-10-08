// SSOT Phase 051 §1.2 — api-layer alias (no logic duplication).
// Canonical: apps/backend/src/api/graphql/resolvers/preview.resolver.ts
// (legacy src/backend/api/graphql/resolvers/preview.resolver.ts)
// - Single implementation lives in modules/preview/resolvers; this file only
//   re-exports so both boundary paths resolve (Gate 9).
export { PreviewResolver } from '../../../modules/preview/resolvers/preview.resolver';
