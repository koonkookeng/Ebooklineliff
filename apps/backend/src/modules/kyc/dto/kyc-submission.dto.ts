// SSOT Phase 085 §5.1 — KYC submission DTOs (thin transport; Zod owns validation)
// Canonical: apps/backend/src/modules/kyc/dto/kyc-submission.dto.ts
// - Zero new deps.
export interface KycSubmissionDto {
  idCardNumber: string;
  laserCode: string;
  firstNameTh: string;
  lastNameTh: string;
  birthDate: string;
  idCardImageUrl: string;
  selfieImageUrl: string;
  bankCode: string;
  bankAccountNumber: string;
  bankAccountName: string;
  bookbankImageUrl: string;
  taxId?: string;
}
