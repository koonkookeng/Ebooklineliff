// SSOT Phase 082 §5.1 — Tax request DTOs (thin transport; Zod owns validation)
// Canonical: apps/backend/src/modules/tax/application/dto/tax-request.dto.ts
// - Zero new deps.
export interface UpsertTaxProfileDto {
  payerType: 'INDIVIDUAL' | 'JURISTIC_PERSON';
  taxId: string;
  fullNameOrCompanyName: string;
  branchCode?: string;
  address: string;
  isTaxExempt?: boolean;
}

export interface GenerateCertificateDto {
  grossAmount: number;
  incomeType?: 'CREATOR_SHARE_40_8' | 'AFFILIATE_COMMISSION_40_2' | 'SERVICE_FEE_40_8';
  formType?: 'PND_1K' | 'PND_2' | 'PND_3' | 'PND_53';
  payoutRequestId?: string;
}
