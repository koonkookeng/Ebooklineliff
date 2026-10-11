// SSOT Phase 120 §5.1 — Legacy security-resolver alias (canonical: api/graphql)
// - The intent single source lives in api/graphql/resolvers/security.resolver.ts
//   (§9 — no duplicated intent logic). This file only re-exports it for the
//   IN_SCOPE module path. Zero new deps.
export { SecurityResolver } from '../../../api/graphql/resolvers/security.resolver';

// Back-compat alias for the early double-suffixed class name.
export { SecurityResolver as SecurityResolverResolver } from '../../../api/graphql/resolvers/security.resolver';
