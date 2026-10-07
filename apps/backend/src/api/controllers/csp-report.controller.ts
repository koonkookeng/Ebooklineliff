// SSOT Phase 028 §7.2 — legacy alias (canonical lives in infra/security)
// Canonical: apps/backend/src/api/controllers/csp-report.controller.ts
// (legacy src/backend/api/controllers/csp-report.controller.ts)
// Re-export only (Phase 026 social-share precedent); registered once via SecurityModule.
export { CspReportController } from '../../infra/security/csp-report.controller';
