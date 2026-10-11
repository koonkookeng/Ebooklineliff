// SSOT Phase 127 §5 — api middleware alias (canonical impl lives in modules/security/waf)
// (legacy src/backend/api/middlewares/* — no logic duplication).
export { SqlInjectionFilterMiddleware, scanSqlInjectionInput, type WafAuditPort } from '../../modules/security/waf/sql-injection-filter.middleware';
