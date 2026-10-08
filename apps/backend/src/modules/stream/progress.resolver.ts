// SSOT Phase 064 §5.1 — stream progress alias (canonical mapping note)
// Canonical: apps/backend/src/modules/stream/progress.resolver.ts
// (legacy src/backend/modules/stream/progress.resolver.ts)
// - The syncOfflineCourseBatch GraphQL field lives on CourseProgressResolver
//   (../progress/resolvers/course-progress.resolver.ts); this file re-exports
//   it so the Phase 064 tree path resolves without a duplicate field registration.
export * from '../progress/resolvers/course-progress.resolver';
