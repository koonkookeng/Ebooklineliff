// SSOT Phase 018 — legacy resolver alias (filefolder inventory path).
// Canonical implementation: apps/backend/src/modules/library/resolvers/library.resolver.ts
// This alias intentionally defines NO GraphQL fields (single-field ownership
// avoids code-first schema collisions); it re-exports the type for imports.
export { LibraryResolver } from '../../../modules/library/resolvers/library.resolver';
