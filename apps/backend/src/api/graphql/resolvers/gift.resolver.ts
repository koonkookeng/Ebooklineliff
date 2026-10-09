// SSOT Phase 089 Task 4 — legacy alias (canonical lives in modules/gift)
// Canonical: apps/backend/src/api/graphql/resolvers/gift.resolver.ts
// Re-export only (078–088 precedent); registered once via GiftModule.
export { GiftResolver } from '../../../modules/gift/api/graphql/gift.resolver';
