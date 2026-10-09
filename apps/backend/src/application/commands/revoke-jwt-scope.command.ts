// SSOT Phase 106 Task 4 — RevokeJwtScopeCommand (JTI blacklist intent, <1s fan-out)
export interface RevokeJwtScopeCommand {
  jti: string;
  userId: string;
  reason: string;
  ttlSeconds?: number;
}
