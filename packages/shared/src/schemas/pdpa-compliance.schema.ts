// SSOT Phase 129 §3.1 — LINE + PDPA compliance contract
// Canonical: packages/shared/src/schemas/pdpa-compliance.schema.ts
// (legacy src/shared/schemas/sdid-contract.ts)
// - Spec-verbatim: ConsentPurposeEnum / DSRTypeEnum / DSRStatusEnum /
//   PDPAConsentPayloadSchema / DataSubjectRequestSchema /
//   LineWebhookHeaderSchema.
// - RISK_CALL deviations (additive-only, documented):
//   - consentVersion/userAgent accept min(1) (spec bare string() is the
//     narrow case; 023-031 precedent for version/UA fields).
//   - reason caps at 500 chars (spec) — enforced, verbatim.
// - Pure helpers: mandatory-purpose gate, purpose diffing, DSR terminal
//   check, HMAC/verify budgets. Zero new deps (zod only).
import { z } from 'zod';

export const ConsentPurposeEnum = z.enum([
  'NECESSARY_TERMS',
  'MARKETING_PROMOTION',
  'ANALYTICS_BEHAVIOR',
  'THIRD_PARTY_TRANSFER',
]);
export type ConsentPurpose = z.infer<typeof ConsentPurposeEnum>;

export const DSRTypeEnum = z.enum([
  'RIGHT_TO_ACCESS',
  'RIGHT_TO_ERASURE',
  'RIGHT_TO_RECTIFY',
  'RIGHT_TO_PORTABILITY',
  'RIGHT_TO_OBJECT',
]);
export type DSRType = z.infer<typeof DSRTypeEnum>;

export const DSRStatusEnum = z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED']);
export type DSRStatus = z.infer<typeof DSRStatusEnum>;

export const PDPAConsentPayloadSchema = z.object({
  consentVersion: z.string().min(1),
  acceptedPurposes: z.array(ConsentPurposeEnum),
  ipAddress: z.string().ip(),
  userAgent: z.string().min(1),
  acceptedAt: z.string().datetime(),
});
export type PDPAConsentPayload = z.infer<typeof PDPAConsentPayloadSchema>;

export const DataSubjectRequestSchema = z.object({
  requestType: DSRTypeEnum,
  reason: z.string().max(500).optional(),
  identityVerificationProof: z.string().min(1),
});
export type DataSubjectRequestInput = z.infer<typeof DataSubjectRequestSchema>;

export const LineWebhookHeaderSchema = z.object({
  'x-line-signature': z.string().min(1),
});
export type LineWebhookHeader = z.infer<typeof LineWebhookHeaderSchema>;

/** BDD-1: LINE signature verification ceiling (5ms). */
export const LINE_SIGNATURE_BUDGET_MS = 5;
/** BDD-2: session/entitlement revocation ceiling (1s). */
export const REVOKE_ALL_BUDGET_MS = 1000;
/** Current consent policy version (bumped on policy change => re-gate). */
export const PDPA_CONSENT_VERSION = '2026-10-01';
/** DSR reason cap (spec §3.1 verbatim). */
export const DSR_REASON_MAX = 500;
/** Data-export ticket TTL (24h HMAC download, 019 precedent). */
export const DATA_EXPORT_TTL_SEC = 86400;

/** Mandatory purposes that can never be toggled off (strict gate). */
export const MANDATORY_PURPOSES: readonly ConsentPurpose[] = ['NECESSARY_TERMS'];

/** True when every mandatory purpose is accepted. */
export function hasMandatoryConsent(purposes: readonly string[]): boolean {
  return MANDATORY_PURPOSES.every((p) => purposes.includes(p));
}

/** Purposes granted now but missing before (for history ledger rows). */
export function newlyGrantedPurposes(
  before: readonly string[],
  after: readonly string[],
): ConsentPurpose[] {
  const prev = new Set(before);
  return (after as ConsentPurpose[]).filter((p) => !prev.has(p));
}

/** Purposes withdrawn (for history ledger rows + downstream revoke). */
export function withdrawnPurposes(
  before: readonly string[],
  after: readonly string[],
): ConsentPurpose[] {
  const next = new Set(after);
  return (before as ConsentPurpose[]).filter((p) => !next.has(p));
}

/** True when a DSR row reached a terminal state. */
export function isDsrTerminal(status: DSRStatus): boolean {
  return status === 'COMPLETED' || status === 'REJECTED';
}

/** Consent ledger key (per user, per purpose). */
export function consentLedgerKey(userId: string, purpose: string): string {
  return `pdpa:consent:{${userId}}:${purpose}`;
}

/** DSR idempotency key (one active request per user+type). */
export function dsrIdempotencyKey(userId: string, requestType: string): string {
  return `pdpa:dsr:{${userId}}:${requestType}`;
}
