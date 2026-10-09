// SSOT Phase 085 §3.1 — Creator e-KYC verification contract
// Canonical: packages/shared/src/schemas/kyc-contract.ts
// (legacy src/shared/schemas/kyc-contract.ts — placeholder until this phase)
// - Spec-verbatim: CreatorKYCInputSchema / KYCOcrResponseSchema /
//   KYCApprovalActionSchema + BankCodeEnum (§3.1).
// - RISK_CALL deviations (additive-only, documented):
//   (a) KYCStatusEnum is owned by identity.zod.ts (4 values) → this module
//       exports CreatorKYCStatusEnum (085 §3.1 + ACTION_REQUIRED);
//   (b) name-match tiers follow §7 (≥0.90 auto / 0.75–0.89 review / <0.75
//       reject), not the §5.2 sketch's single 0.80 gate;
//   (c) approval activates kycStatus + payout account only — UserRole has no
//       VERIFIED_CREATOR value (role grants stay a separate admin action).
// - Pure helpers: Thai ID checksum, laser format, Thai title stripping,
//   Levenshtein fuzzy match, score tiers, R2 key builders, stream keys.
// - Zero new deps (zod only).
import { z } from 'zod';

export const CreatorKYCStatusEnum = z.enum([
  'NOT_SUBMITTED',
  'PENDING',
  'VERIFIED',
  'REJECTED',
  'ACTION_REQUIRED',
]);
export type CreatorKYCStatus = z.infer<typeof CreatorKYCStatusEnum>;

export const BankCodeEnum = z.enum([
  'KBANK', 'SCB', 'BBL', 'KTB', 'BAY', 'TTB', 'GSB', 'CIMB', 'UOB',
]);
export type BankCode = z.infer<typeof BankCodeEnum>;

export const CreatorKYCInputSchema = z.object({
  idCardNumber: z.string().length(13, 'เลขบัตรประชาชนต้องมี 13 หลัก').regex(/^\d+$/, 'ต้องเป็นตัวเลขเท่านั้น'),
  laserCode: z.string().length(12, 'รหัสหลังบัตรประชาชนต้องมี 12 หลัก (2 อักษร + 10 ตัวเลข)'),
  firstNameTh: z.string().min(1, 'กรุณาระบุชื่อภาษาไทย'),
  lastNameTh: z.string().min(1, 'กรุณาระบุนามสกุลภาษาไทย'),
  birthDate: z.string().datetime(),
  idCardImageUrl: z.string().url('URL ภาพหน้าบัตรไม่ถูกต้อง'),
  selfieImageUrl: z.string().url('URL ภาพถ่ายคู่บัตร/ใบหน้าไม่ถูกต้อง'),
  bankCode: BankCodeEnum,
  bankAccountNumber: z.string().min(8).max(15).regex(/^\d+$/, 'เลขบัญชีต้องเป็นตัวเลขเท่านั้น'),
  bankAccountName: z.string().min(1, 'กรุณาระบุชื่อบัญชีธนาคาร'),
  bookbankImageUrl: z.string().url('URL ภาพหน้าสมุดบัญชีไม่ถูกต้อง'),
  taxId: z.string().optional(),
});
export type CreatorEKYCInput = z.infer<typeof CreatorKYCInputSchema>;
// NOTE: named CreatorEKYCInput (not CreatorKYCInput) — identity.zod.ts
// already owns the CreatorKYCInput type name (003 basic KYC) via
// `export *`, and a same-named export here would shadow it.

export const KYCOcrResponseSchema = z.object({
  success: z.boolean(),
  extractedData: z.object({
    idCardNumber: z.string().optional(),
    firstNameTh: z.string().optional(),
    lastNameTh: z.string().optional(),
    birthDate: z.string().optional(),
    address: z.string().optional(),
    ocrConfidence: z.number().min(0).max(1),
  }),
  isBlurry: z.boolean(),
  hasGlare: z.boolean(),
});
export type KYCOcrResponse = z.infer<typeof KYCOcrResponseSchema>;

export const KYCApprovalActionSchema = z.object({
  kycId: z.string().uuid(),
  status: z.enum(['VERIFIED', 'REJECTED', 'ACTION_REQUIRED']),
  rejectionReason: z.string().optional(),
  adminNote: z.string().optional(),
});
export type KYCApprovalAction = z.infer<typeof KYCApprovalActionSchema>;

/** Auto-approve threshold (§7: score ≥ 0.90). */
export const KYC_AUTO_APPROVE_SCORE = 0.9;
/** Manual-review floor (§7: 0.75–0.89 → ACTION_REQUIRED). */
export const KYC_REVIEW_FLOOR_SCORE = 0.75;
/** R2 presigned upload TTL for KYC documents. */
export const KYC_UPLOAD_TTL_SEC = 900;
/** Admin review URL TTL: 3 minutes (§8). */
export const KYC_VIEW_TTL_SEC = 180;
/** KYC event stream (Gate 8). */
export const KYC_EVENT_STREAM = 'stream:kyc:events';

/** Thai national ID checksum (mod-11, DOPA rule). */
export function thaiIdChecksum(idCardNumber: string): boolean {
  if (!/^\d{13}$/.test(idCardNumber)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(idCardNumber[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(idCardNumber[12]);
}

/** Laser code format: 2 letters + 10 digits (12 chars, §3.1). */
export function laserFormatValid(laserCode: string): boolean {
  return /^[A-Z]{2}\d{10}$/i.test(laserCode);
}

const THAI_TITLES = [
  'นาย', 'นาง', 'นางสาว', 'ดร.', 'ดอกเตอร์', 'ว่าที่ร้อยตรี', 'ว่าที่ร้อยโท', 'ว่าที่ร้อยเอก',
  'ร้อยตรี', 'ร้อยโท', 'ร้อยเอก', 'พันตรี', 'พันโท', 'พันเอก', 'พลตรี', 'พลโท', 'พลเอก',
  'เรือตรี', 'เรือโท', 'เรือเอก', 'นาวาตรี', 'นาวาโท', 'นาวาเอก', 'MR', 'MRS', 'MISS', 'MS', 'DR',
];

/** Strip Thai honorifics/titles before name matching (§10.1 edge case). */
export function stripThaiTitle(fullName: string): string {
  let out = fullName.trim().replace(/\s+/g, ' ');
  for (const t of THAI_TITLES) {
    if (out.startsWith(`${t} `)) {
      out = out.slice(t.length + 1);
      break;
    }
  }
  return out;
}

/** Levenshtein distance (Unicode-safe for Thai script). */
export function levenshtein(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const n = x.length;
  const m = y.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= m; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        (prev[j] as number) + 1,
        (cur[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
    }
    prev = cur;
  }
  return prev[m] as number;
}

/**
 * Fuzzy name score (§7 formula): 1 − dist/max(len). Titles stripped,
 * case/space normalized.
 */
export function fuzzyNameScore(idCardName: string, bankAccountName: string): number {
  const norm = (s: string): string[] => [...stripThaiTitle(s).toUpperCase().replace(/\s+/g, '')];
  const a = norm(idCardName).join('');
  const b = norm(bankAccountName).join('');
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  return Math.round((1 - levenshtein(a, b) / longest) * 10_000) / 10_000;
}

/** Decision tier for a match score (§7). */
export function kycScoreTier(score: number): 'AUTO' | 'REVIEW' | 'REJECT' {
  if (score >= KYC_AUTO_APPROVE_SCORE) return 'AUTO';
  if (score >= KYC_REVIEW_FLOOR_SCORE) return 'REVIEW';
  return 'REJECT';
}

/** R2 private-vault object key for a KYC document. */
export function kycObjectKey(userId: string, kind: 'id-card' | 'selfie' | 'bookbank', at = Date.now()): string {
  return `tenants/kyc/${userId}/${kind}-${at.toString(36)}.jpg`;
}
