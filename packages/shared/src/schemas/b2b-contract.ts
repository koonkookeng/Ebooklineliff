// SSOT Phase 097 §3.1 — B2B corporate license Zod domain contract
// Canonical: packages/shared/src/schemas/b2b-contract.ts
// (legacy placeholder shared by Phase 097/098 — 097 owns this surface;
// 098 extends with its own HR/seat models when it lands)
// - Spec-verbatim: CorporateLicenseStatusEnum / SeatStatusEnum /
//   CreateCorporateLicenseInputSchema / ClaimCorporateSeatPayloadSchema /
//   BulkSeatInviteInputSchema (§3.1).
// - RISK_CALL (documented): Thai taxId gate is checksum-shaped (13 digits;
//   full RD checksum lives in tax-contract 082 — reuse there for filings).
//   License codes are human-readable CORP-<base36>-<rand4>.
// - Pure helpers: seat math, claim link, invite code, stream. Zod only.
import { z } from 'zod';

export const CorporateLicenseStatusEnum = z.enum(['ACTIVE', 'EXPIRED', 'SUSPENDED', 'EXHAUSTED']);
export type CorporateLicenseStatus = z.infer<typeof CorporateLicenseStatusEnum>;

export const SeatStatusEnum = z.enum(['UNASSIGNED', 'INVITED', 'ACTIVE', 'REVOKED']);
export type SeatStatus = z.infer<typeof SeatStatusEnum>;

export const CreateCorporateLicenseInputSchema = z.object({
  corporateName: z.string().min(2),
  taxId: z.string().length(13),
  contactEmail: z.string().email(),
  productId: z.string().uuid(),
  totalSeats: z.number().int().positive(),
  expiresInDays: z.number().int().positive().default(365),
});
export type CreateCorporateLicenseInput = z.infer<typeof CreateCorporateLicenseInputSchema>;

export const ClaimCorporateSeatPayloadSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  licenseId: z.string().uuid(),
  assignedSeatId: z.string().uuid(),
  entitlementGranted: z.boolean(),
  remainingSeats: z.number().int().min(0),
});
export type ClaimCorporateSeatPayload = z.infer<typeof ClaimCorporateSeatPayloadSchema>;

export const BulkSeatInviteInputSchema = z.object({
  licenseId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
  emails: z.array(z.string().email()).optional(),
  lineUserIds: z.array(z.string()).optional(),
});
export type BulkSeatInviteInput = z.infer<typeof BulkSeatInviteInputSchema>;

/** Default corporate license TTL: 365 days (BDD-1). */
export const CORPORATE_DEFAULT_EXPIRY_DAYS = 365;
/** B2B event stream (Gate 8: claims + HR analytics). */
export const B2B_STREAM = 'stream:b2b:licenses';

/** Remaining seats in a pool (never negative). */
export function remainingSeats(totalSeats: number, usedSeats: number): number {
  return Math.max(0, totalSeats - usedSeats);
}

/** License status flip when the pool fills. */
export function licenseStatusAfter(totalSeats: number, usedSeats: number): 'ACTIVE' | 'EXHAUSTED' {
  return usedSeats >= totalSeats ? 'EXHAUSTED' : 'ACTIVE';
}

/** Human license code: CORP-<base36 time>-<rand4> (Flex-friendly). */
export function corporateLicenseCode(at = Date.now(), rand = Math.floor(Math.random() * 36 ** 4)): string {
  return `CORP-${at.toString(36).toUpperCase()}-${rand.toString(36).toUpperCase().padStart(4, '0')}`;
}

/** Employee claim deep-link into the LIFF B2B entry. */
export function corporateClaimUrl(origin: string, licenseCode: string): string {
  return `${origin.replace(/\/$/, '')}/b2b/claim?code=${encodeURIComponent(licenseCode)}`;
}

/** Redis single-claim mutex key (§5.2 race guard). */
export function corporateClaimLockKey(licenseCode: string): string {
  return `lock:b2b:claim:${licenseCode}`;
}

/** Redacted taxId for logs (last 4 visible, PDPA). */
export function maskTaxId(taxId: string): string {
  return `XXXXXXXXX${taxId.slice(-4)}`;
}
