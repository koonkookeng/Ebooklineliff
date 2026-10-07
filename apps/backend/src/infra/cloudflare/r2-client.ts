// SSOT Phase 038 Task 5 — R2 client alias (canonical transport lives in r2-storage.service)
// Canonical: apps/backend/src/infra/cloudflare/r2-client.ts
// (legacy src/backend/infra/cloudflare/r2-client.ts; shared across Phases 038/043/102/123)
// Re-export only (zero-redundant policy): the SigV4 transport is R2StorageService.
export { R2StorageService } from './r2-storage.service';
export type { R2Config } from './r2-storage.service';
