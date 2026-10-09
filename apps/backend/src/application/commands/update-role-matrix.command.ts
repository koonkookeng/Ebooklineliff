// SSOT Phase 106 Task 5 — UpdateRoleMatrixCommand (CQRS intent, Zod-gated by controller)
export interface UpdateRoleMatrixCommand {
  tenantId: string;
  roleId: string;
  bitmask: string;
  scopes: string[];
  actorUserId: string;
  ipAddress?: string;
  userAgent?: string;
}
