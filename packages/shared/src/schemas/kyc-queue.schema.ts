// SSOT Phase 111 §3.1 — Creator KYC queue contract (submission/review/OCR-risk)
// Canonical: packages/shared/src/schemas/kyc-queue.schema.ts
// - Spec-verbatim: KYCDocTypeEnum / KYCRiskLevelEnum / KycSubmissionInputSchema
//   / KycReviewPayloadSchema / OcrExtractionResultSchema.
// - RISK_CALL deviations (additive-only, documented):
//   - Checksum/fuzzy helpers live in kyc-contract.ts (085) and are imported,
//     never duplicated.
//   - Risk tiers follow 111 §7.1 percent scale (≥95 LOW / 80–94 MEDIUM /
//     <80 HIGH, duplicate → CRITICAL) — the 085 0.90/0.75 gate stays untouched
//     for the 085 submission flow.
//   - userId/kycId accept min(1) edge vocabulary in addition to uuid
//     (Phase 023-031 precedent).
// - Zero new deps (zod only).
import { z } from 'zod';
import { thaiIdChecksum } from './kyc-contract';

export const KYCDocTypeEnum = z.enum([
  'THAI_NATIONAL_ID',
  'PASSPORT',
  'COMPANY_REGISTRATION',
  'BANK_BOOK',
]);
export type KYCDocType = z.infer<typeof KYCDocTypeEnum>;

export const KYCRiskLevelEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type KYCRiskLevel = z.infer<typeof KYCRiskLevelEnum>;

/** 111 LIFF wizard submission (base64 docs + single Thai full name). */
export const KycSubmissionInputSchema = z.object({
  idCardNumber: z.string().length(13, 'เลขบัตรประชาชนต้องมี 13 หลัก').regex(/^[0-9]+$/, 'ต้องเป็นตัวเลขเท่านั้น'),
  fullNameTh: z.string().min(2, 'กรุณาระบุชื่อ-นามสกุลภาษาไทย'),
  dateOfBirth: z.string().datetime(),
  bankName: z.string().min(2, 'กรุณาระบุชื่อธนาคาร'),
  bankAccountNumber: z.string().min(8, 'เลขบัญชีธนาคารไม่ถูกต้อง').max(15),
  bankAccountName: z.string().min(2, 'ชื่อบัญชีต้องตรงกับชื่อผู้สมัคร'),
  taxId: z.string().optional(),
  idCardImageBase64: z.string().min(1, 'กรุณาอัปโหลดรูปบัตรประชาชน'),
  bankBookImageBase64: z.string().min(1, 'กรุณาอัปโหลดรูปหน้าสมุดบัญชี'),
});
export type KycSubmissionInput = z.infer<typeof KycSubmissionInputSchema>;

export const KycReviewPayloadSchema = z.object({
  kycId: z.string().min(1),
  status: z.enum(['VERIFIED', 'REJECTED']),
  rejectionReason: z.string().optional(),
  adminNotes: z.string().max(500).optional(),
});
export type KycReviewPayload = z.infer<typeof KycReviewPayloadSchema>;

export const OcrExtractionResultSchema = z.object({
  extractedIdNumber: z.string().nullable(),
  extractedNameTh: z.string().nullable(),
  extractedBankAccount: z.string().nullable(),
  confidenceScore: z.number().min(0).max(100),
  isDocumentTampered: z.boolean(),
  riskLevel: KYCRiskLevelEnum,
});
export type OcrExtractionResult = z.infer<typeof OcrExtractionResultSchema>;

/** Queue workspace budgets (§1.3 BDD <2s, §8.1 300s presigned). */
export const KYC_QUEUE_PAGE_SIZE = 20;
export const KYC_DOC_VIEW_TTL_SEC = 300;
export const KYC_VERDICT_SLA_MS = 500;

export function kycQueueKey(status: string, page: number): string {
  return `kyc:queue:${status}:${page}`;
}

/**
 * 111 §7.1 risk tier from name-match percent (0–100).
 * Duplicate ID always escalates to CRITICAL regardless of match.
 */
export function kycRiskTier111(matchPercent: number, opts?: { duplicateId?: boolean; tampered?: boolean; checksumValid?: boolean }): KYCRiskLevel {
  if (opts?.duplicateId === true) return 'CRITICAL';
  if (opts?.tampered === true) return 'HIGH';
  if (opts?.checksumValid === false) return 'HIGH';
  if (matchPercent >= 95) return 'LOW';
  if (matchPercent >= 80) return 'MEDIUM';
  return 'HIGH';
}

export function isValidKycSubmissionId(idCardNumber: string): boolean {
  return thaiIdChecksum(idCardNumber);
}
