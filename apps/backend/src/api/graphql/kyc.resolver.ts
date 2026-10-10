// SSOT Phase 111 §3.2 — legacy api-layer alias (contract record lives in module).
// Canonical: apps/backend/src/api/graphql/kyc.resolver.ts
// (legacy src/backend/api/graphql/kyc.resolver.ts)
// - 085 KycResolver (submitKyc/getKycStatus/decideKyc) + 111 KycQueueResolver
//   (getKycVerificationQueue/reviewCreatorKyc/submitCreatorKyc111/
//   getMyKycStatus111) re-exported; no scaffold placeholder.
export { KycResolver as KycModuleResolver } from '../../modules/kyc/resolvers/kyc.resolver';
export { KycQueueResolver as KycQueueModuleResolver } from '../../modules/kyc/resolvers/kyc-queue.resolver';
