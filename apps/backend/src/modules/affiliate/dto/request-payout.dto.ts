// SSOT Phase 079 §5.1 — Request payout DTO (Zod-gated at the service)
// Canonical: apps/backend/src/modules/affiliate/dto/request-payout.dto.ts
// - Thin transport type; validation lives in affiliate-contract.ts.
// - Zero new deps.
export interface RequestPayoutDto {
  amount: number;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
}
