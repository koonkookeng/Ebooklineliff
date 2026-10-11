// SSOT Phase 129 §5 — api interceptor alias (canonical impl lives in modules/pdpa)
// (legacy src/backend/api/interceptors/* — no logic duplication).
export { DlpSanitizerInterceptor, sanitizeForAi, pseudonymize } from '../../modules/pdpa/interceptors/dlp-sanitizer.interceptor';
