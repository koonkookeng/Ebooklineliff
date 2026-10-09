// SSOT Phase 100 §3.2 — module alias (single runtime in api/graphql)
// Canonical: apps/backend/src/modules/stream/live-stream.resolver.ts
// - Re-export only (097 alias precedent); StreamModule provides the api
//   resolver class directly. Zero new deps.
export { LiveStreamResolver } from '../../api/graphql/live-stream.resolver';
