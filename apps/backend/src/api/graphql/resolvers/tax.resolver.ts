// SSOT Phase 082 §3.2 — legacy alias (canonical lives in modules/tax)
// Canonical: apps/backend/src/api/graphql/resolvers/tax.resolver.ts
// Re-export only (078–081 precedent); registered once via TaxModule.
export { TaxResolver } from '../../../modules/tax/presentation/graphql/tax.resolver';
