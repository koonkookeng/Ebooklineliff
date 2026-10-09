// SSOT Phase 105 — api-layer resolver alias (no logic duplication).
// Canonical: apps/backend/src/api/graphql/resolvers/certificate.resolver.ts
// (legacy src/backend/api/graphql/resolvers/certificate.resolver.ts)
// - Single implementation lives in modules/certificate/certificate.resolver.ts.
export { PublicCertificateResolver } from '../../../modules/certificate/certificate.resolver';
