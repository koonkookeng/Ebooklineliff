// SSOT Phase 127 §5 — api guard alias (canonical impl lives in modules/security)
// (legacy src/backend/api/guards/* — no logic duplication; 028/106 precedent).
export { DrmEntitlementGuard, DrmEntitlementGuardGuard, entitlementKey, type DrmEntitlementEdgePort, type DrmAuditPort } from '../../modules/security/guards/drm-entitlement.guard';
