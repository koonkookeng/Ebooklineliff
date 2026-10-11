// SSOT Phase 005 §5.1 — root strategy alias (canonical impl lives in modules/auth)
// (legacy src/backend/strategies/jwt.strategy.ts — no logic duplication;
// 127/129 alias precedent).
export { JwtStrategy } from '../modules/auth/strategies/jwt.strategy';
