// SSOT Phase 129 §5 — api guard alias (canonical impl lives in modules/security)
// (legacy src/backend/api/guards/* — no logic duplication; 127 precedent).
export { LineLiffAuthGuard, LineLiffAuthGuardGuard, type LineProfile } from '../../modules/security/guards/line-liff-auth.guard';
