// SSOT Phase 105 §3.1 — Public verification status domain enum
// Canonical: apps/backend/src/modules/certificate/domain/certificate-status.enum.ts
// - VERIFIED / INVALID / REVOKED / EXPIRED (§3.1 VerificationStatusEnum).
// - Maps 048 legacy `status` string + additive `isRevoked` flag.
// - Pure + tsx-safe. Zero new deps.
import type { VerificationStatus } from '@repo/shared';

export const CertificateVerifyStatus = {
  VERIFIED: 'VERIFIED',
  INVALID: 'INVALID',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
} as const;
export type CertificateVerifyStatus = (typeof CertificateVerifyStatus)[keyof typeof CertificateVerifyStatus];

/** Maps legacy 048 status string + additive revoke flag to §3.1 status. */
export function fromLegacyStatus(legacyStatus: string, isRevoked: boolean): VerificationStatus {
  if (isRevoked || legacyStatus === 'REVOKED') return 'REVOKED';
  if (legacyStatus === 'EXPIRED') return 'EXPIRED';
  if (legacyStatus === 'ISSUED') return 'VERIFIED';
  return 'INVALID';
}
