// SSOT Phase 123 Task 6 §3.2 — legacy api-layer alias (contract record lives in module).
// Canonical: apps/backend/src/api/graphql/resolvers/storage-management.resolver.ts
// (legacy src/backend/api/graphql/resolvers/storage-management.resolver.ts)
export { StorageResolver as StorageManagementResolver } from '../../../modules/storage/resolvers/storage.resolver';
/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { StorageResolver as StorageManagementResolverResolver } from '../../../modules/storage/resolvers/storage.resolver';
