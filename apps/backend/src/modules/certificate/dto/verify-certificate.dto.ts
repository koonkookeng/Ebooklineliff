// SSOT Phase 105 §3.1 — Public verify request DTO (Zod-backed)
// Canonical: apps/backend/src/modules/certificate/dto/verify-certificate.dto.ts
// - Re-exports SSOT input schema + narrows controller params. Zero new deps.
import { VerifyCertificateInputSchema, type VerifyCertificateInput } from '@repo/shared';

export { VerifyCertificateInputSchema };
export type { VerifyCertificateInput };

export interface PublicVerifyParams extends VerifyCertificateInput {
  ipAddress: string;
  userAgent: string;
}
