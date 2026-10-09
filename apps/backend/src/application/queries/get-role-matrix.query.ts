// SSOT Phase 106 Task 5 — GetRoleMatrixQuery (tenant-scoped read intent)
export interface GetRoleMatrixQuery {
  tenantId: string;
  roleId: string;
}
