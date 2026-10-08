// SSOT Phase 065 §5.1 — api-layer note resolver alias (canonical mapping)
// Canonical: apps/backend/src/api/graphql/resolvers/note.resolver.ts
// (legacy src/backend/api/graphql/resolvers/note.resolver.ts)
// - Runtime lives in modules/note/resolvers/note.resolver.ts (code-first);
//   this file re-exports it so the Phase 065 tree path resolves without a
//   duplicate field registration.
export * from '../../../modules/note/resolvers/note.resolver';
