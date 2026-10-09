// SSOT Phase 105 §3.1 — Certificate verification Zod domain contract
// Canonical: packages/shared/src/schemas/certificate-verification.schema.ts
// - Spec-verbatim: VerificationStatusEnum / VerifyCertificateInputSchema /
//   CertificateIssuerSchema / CertificateStudentInfoSchema /
//   CertificateDetailSchema / CertificateVerificationPayloadSchema (§3.1).
// - Pure helpers: certNo format, rate key, budgets. Zod only.
import { z } from 'zod';

export const VerificationStatusEnum = z.enum(['VERIFIED', 'INVALID', 'REVOKED', 'EXPIRED']);
export type VerificationStatus = z.infer<typeof VerificationStatusEnum>;

export const VerifyCertificateInputSchema = z.object({
  certificateNo: z.string().min(5).max(50),
  hashSignature: z.string().optional(),
});
export type VerifyCertificateInput = z.infer<typeof VerifyCertificateInputSchema>;

export const CertificateIssuerSchema = z.object({
  tenantId: z.string().uuid(),
  tenantName: z.string(),
  logoUrl: z.string().url(),
  verifiedDomain: z.string(),
});
export type CertificateIssuer = z.infer<typeof CertificateIssuerSchema>;

export const CertificateStudentInfoSchema = z.object({
  studentName: z.string(),
  avatarUrl: z.string().url().nullable(),
  completionDate: z.string().datetime(),
});
export type CertificateStudentInfo = z.infer<typeof CertificateStudentInfoSchema>;

export const CertificateDetailSchema = z.object({
  certificateNo: z.string(),
  courseTitle: z.string(),
  courseSlug: z.string(),
  totalHours: z.number().nonnegative(),
  issuedAt: z.string().datetime(),
  pdfDownloadUrl: z.string().url(),
  student: CertificateStudentInfoSchema,
  issuer: CertificateIssuerSchema,
});
export type CertificateDetail = z.infer<typeof CertificateDetailSchema>;

export const CertificateVerificationPayloadSchema = z.object({
  success: z.boolean(),
  status: VerificationStatusEnum,
  message: z.string(),
  data: CertificateDetailSchema.nullable(),
  scannedAt: z.string().datetime(),
});
export type CertificateVerificationPayload = z.infer<typeof CertificateVerificationPayloadSchema>;

/** Public verification latency budget: < 500ms (BDD §1.3). */
export const CERT_VERIFY_LATENCY_MS = 500;

/** Public page RAM budget: < 25MB (§2.1). */
export const CERT_VERIFY_RAM_MB = 25;

/** Public page bundle budget: < 45KB gzipped (§2.1). */
export const CERT_VERIFY_BUNDLE_KB = 45;

/** Anti-scrape rate limit: 20 scans/min/IP (BDD §1.3). */
export const CERT_VERIFY_RATE_PER_MIN = 20;

/** Redis key for per-IP public scan rate limiting (§8.1). */
export function certVerifyRateKey(ip: string): string {
  return `ratelimit:cert-verify:${ip}`;
}

/** Canonical certificate number shape: CERT-2026-XXXXXX. */
export function isCertificateNoFormat(certNo: string): boolean {
  return /^CERT-[A-Z0-9-]{4,44}$/.test(certNo);
}
