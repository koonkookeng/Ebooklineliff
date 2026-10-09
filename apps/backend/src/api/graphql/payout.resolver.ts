// SSOT Phase 086 §3.2 — legacy alias (canonical lives in modules/payout)
// Canonical: apps/backend/src/api/graphql/payout.resolver.ts
// Re-export only (078–085 precedent); registered once via PayoutModule.
export { PayoutResolver } from '../../modules/payout/resolvers/payout.resolver';
