// SSOT Phase 064 §5.1 — reader progress alias (canonical mapping note)
// Canonical: apps/backend/src/modules/reader/progress.resolver.ts
// (legacy src/backend/modules/reader/progress.resolver.ts)
// - The syncEbookProgress GraphQL field lives on ReaderResolver
//   (./reader.resolver.ts, Phase 040); this file re-exports it so the
//   Phase 064 tree path resolves without a duplicate field registration.
export * from './reader.resolver';
