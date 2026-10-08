// SSOT Phase 078 §3.2 — legacy alias (canonical lives in modules/course-studio)
// Canonical: apps/backend/src/api/graphql/resolvers/course-studio.resolver.ts
// Re-export only (077 precedent); registered once via CourseStudioModule.
export { CourseStudioResolver } from '../../../modules/course-studio/presentation/course-studio.resolver';
