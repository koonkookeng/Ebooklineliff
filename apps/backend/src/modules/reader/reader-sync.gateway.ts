// SSOT Phase 070 Task 2 — reader sync-gateway alias (canonical mapping)
// Canonical: apps/backend/src/modules/reader/reader-sync.gateway.ts
// (legacy src/backend/modules/reader/reader-sync.gateway.ts)
// - Realtime transport lives in the Phase 057 ProgressSyncGateway
//   (SSE rooms); this file re-exports it so the Phase 070 tree path
//   resolves without a duplicate controller registration.
export * from '../sync/infrastructure/gateways/progress-sync.gateway';
