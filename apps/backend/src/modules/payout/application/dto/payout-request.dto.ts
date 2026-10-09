// SSOT Phase 086 §5.1 — Payout request DTOs (thin transport; Zod owns validation)
// Canonical: apps/backend/src/modules/payout/application/dto/payout-request.dto.ts
// - Zero new deps.
export interface PayoutRequestDto {
  amount: number;
  bankAccountId: string;
  remark?: string;
}
