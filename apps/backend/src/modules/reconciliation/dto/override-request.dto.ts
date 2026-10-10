// SSOT Phase 115 §3.1 — override transport DTOs (thin; Zod owns validation)
// Canonical: apps/backend/src/modules/reconciliation/dto/override-request.dto.ts
// - Zero new deps.
export interface OverrideRequestDto {
  statementId: string;
  orderId: string;
  overrideReason: string;
  adjustmentNote?: string;
  checkerUserId?: string;
}

export interface OverrideApprovalDto {
  overrideId: string;
  checkerUserId?: string;
}
