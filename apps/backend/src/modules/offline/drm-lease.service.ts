// SSOT Phase 063 §5.1 — root-path alias (duplicate scaffold consolidation)
// Canonical: apps/backend/src/modules/offline/drm-lease.service.ts
// - Re-export only; implementation lives in ./services/drm-lease.service.ts.
export * from './services/drm-lease.service';
