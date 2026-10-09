// SSOT Phase 106 — api-layer resolver alias (no logic duplication).
// Canonical: apps/backend/src/api/graphql/resolvers/permission.resolver.ts
// (legacy src/backend/api/graphql/resolvers/permission.resolver.ts)
// - Single implementation lives in modules/security-matrix/security-matrix.resolver.
export { SecurityMatrixResolver as PermissionResolver } from '../../../modules/security-matrix/security-matrix.resolver';
