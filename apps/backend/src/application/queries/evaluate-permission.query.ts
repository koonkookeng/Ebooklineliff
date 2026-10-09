// SSOT Phase 106 Task 5 — EvaluatePermissionQuery (BDD Scenario 1+2 intent)
export interface EvaluatePermissionQuery {
  userId: string;
  tenantId: string;
  userBitmask: string;
  userScopes: string[];
  requiredBitmask: string;
  requiredScopes: string[];
}
