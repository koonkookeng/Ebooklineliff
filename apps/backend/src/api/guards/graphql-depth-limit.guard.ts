// SSOT Phase 127 §5 — api guard alias (canonical impl lives in modules/security)
// (legacy src/backend/api/guards/* — no logic duplication; 028/106 precedent).
export { GraphQLSecurityGuard, GraphqlDepthLimitGuardGuard, calculateDepth, depthOfQuery } from '../../modules/security/guards/graphql-depth-limit.guard';
