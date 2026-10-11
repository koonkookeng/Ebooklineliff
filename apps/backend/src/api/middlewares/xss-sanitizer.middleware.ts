// SSOT Phase 127 §5 — api middleware alias (canonical impl lives in modules/security/waf)
// (legacy src/backend/api/middlewares/* — no logic duplication).
export { XssSanitizerMiddleware, scanXssInput } from '../../modules/security/waf/xss-sanitizer.middleware';
