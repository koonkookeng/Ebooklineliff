// SSOT Phase 066 §5.1 — reader theme-sync alias (canonical mapping note)
// Canonical: apps/backend/src/modules/reader/services/theme-sync.service.ts
// (legacy src/backend/modules/reader/services/theme-sync.service.ts)
// - Runtime lives in modules/user-preference/user-preference.service.ts;
//   this file re-exports it so the Phase 066 tree path resolves without a
//   duplicate provider registration.
export * from '../../user-preference/user-preference.service';
