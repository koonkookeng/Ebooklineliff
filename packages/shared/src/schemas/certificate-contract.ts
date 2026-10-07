// SSOT Phase 048 §3.1 — Certificate Zod contract
// Canonical: packages/shared/src/schemas/certificate-contract.ts
// (legacy src/shared/schemas/certificate-contract.ts)
// - Spec-verbatim: CertificateStatusEnum / GenerateCertificateInputSchema /
//   VerifyCertificateResponseSchema / CertificatePayloadSchema (§3.1 Gate 1).
// - Additive (zero-dep): certNo generator, QR URL builder, HMAC payload builder,
//   certificateR2Path, verifyUrl.
// - Zero new deps (zod only).
import { z } from 'zod';

export const CertificateStatusEnum = z.enum(['ISSUED', 'REVOKED', 'EXPIRED']);
export type CertificateStatus = z.infer<typeof CertificateStatusEnum>;

export const GenerateCertificateInputSchema = z.object({
  userId: z.string().uuid(),
  courseId: z.string().uuid(),
  tenantId: z.string().optional(),
});
export type GenerateCertificateInput = z.infer<typeof GenerateCertificateInputSchema>;

export const VerifyCertificateResponseSchema = z.object({
  isValid: z.boolean(),
  certificateNo: z.string(),
  studentName: z.string(),
  courseTitle: z.string(),
  issuedAt: z.string(),
  issuerName: z.string(),
  digitalSignatureHash: z.string(),
  pdfUrl: z.string().url(),
});
export type VerifyCertificateResponse = z.infer<typeof VerifyCertificateResponseSchema>;

export const CertificatePayloadSchema = z.object({
  certificateNo: z.string(),
  pdfStoragePathR2: z.string(),
  qrCodeUrl: z.string().url(),
  digitalSignatureHash: z.string(),
  issuedAt: z.string().datetime(),
});
export type CertificatePayload = z.infer<typeof CertificatePayloadSchema>;

/** §3.2 CertificateItem (getMyCertificates list entry). */
export const CertificateItemSchema = z.object({
  id: z.string(),
  certificateNo: z.string(),
  courseTitle: z.string(),
  coverImageUrl: z.string(),
  issuedAt: z.string(),
  pdfUrl: z.string().url(),
  qrCodeUrl: z.string().url(),
});
export type CertificateItem = z.infer<typeof CertificateItemSchema>;

/** §4.1 certificate number generator (CERT-<base36timestamp>-<4digitrandom>). */
export function generateCertificateNo(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `CERT-${timestamp}-${random}`;
}

/** §3.2 verification URL builder. */
export function buildVerifyUrl(certificateNo: string): string {
  return `https://liff.line.me/app/verify/cert/${certificateNo}`;
}

/** §8.2 HMAC payload builder (certNo:userId:courseId:displayName). */
export function buildHmacPayload(certNo: string, userId: string, courseId: string, displayName: string): string {
  return `${certNo}:${userId}:${courseId}:${displayName}`;
}

/** R2 storage path for certificate PDF. */
export function certificateR2Path(certNo: string): string {
  return `certificates/${certNo}.pdf`;
}

/** Verification URL for QR code. */
export function verifyUrl(certNo: string): string {
  return buildVerifyUrl(certNo);
}

/** §8.2 HMAC-SHA256 signature using CERTIFICATE_HMAC_SECRET. */
export function signCertificate(certNo: string, userId: string, courseId: string, displayName: string, secret: string): string {
  const payload = buildHmacPayload(certNo, userId, courseId, displayName);
  const crypto = require('crypto');
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** Verify HMAC signature. */
export function verifyCertificateSignature(certNo: string, userId: string, courseId: string, displayName: string, signature: string, secret: string): boolean {
  const expected = signCertificate(certNo, userId, courseId, displayName, secret);
  // Timing-safe comparison
  if (signature.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}

/** §8.1 verification rate-limit key (20 req/min per IP). */
export function rateLimitKey(ip: string): string {
  return `ratelimit:cert-verify:${ip}`;
}