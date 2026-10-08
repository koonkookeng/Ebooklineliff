// SSOT Phase 079 §5.1 — Create referral link DTO (Zod-gated at the service)
// Canonical: apps/backend/src/modules/affiliate/dto/create-referral-link.dto.ts
// - Thin transport type; validation lives in affiliate-contract.ts.
// - Zero new deps.
export interface CreateReferralLinkDto {
  productId: string;
  customCampaignTag?: string;
}
