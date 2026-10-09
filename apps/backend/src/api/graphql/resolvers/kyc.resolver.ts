// SSOT Phase 085 §3.2 — legacy alias (canonical lives in modules/kyc)
// Canonical: apps/backend/src/api/graphql/resolvers/kyc.resolver.ts
// Re-export only (078–084 precedent); registered once via KycModule.
export { KycResolver } from '../../../modules/kyc/resolvers/kyc.resolver';
