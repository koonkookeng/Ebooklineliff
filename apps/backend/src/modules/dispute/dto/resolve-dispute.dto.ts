// SSOT Phase 113 §3.1 — arbitration transport DTOs (thin; Zod owns validation)
// Canonical: apps/backend/src/modules/dispute/dto/resolve-dispute.dto.ts
// - Zero new deps.
export interface ResolveDisputeDto {
  disputeId: string;
  resolutionStatus: 'APPROVED_REFUND_BUYER' | 'REJECTED_RELEASE_SELLER';
  adminComment: string;
  approvedRefundAmount: number;
  refundToWallet?: boolean;
}
