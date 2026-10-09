// SSOT Phase 107 §3.1 — Data Scope Control + Field-Level Encryption Mask (PDPA)
// Canonical: packages/shared/src/schemas/pdpa-scope.schema.ts
// (legacy src/shared/schemas/pdpa-scope.schema.ts)
// - Spec-verbatim: SensitiveFieldTypeEnum / DataScopeLevelEnum /
//   EncryptedFieldSchema / MaskedUserPayloadSchema / UnmaskRequestSchema.
// - RISK_CALL deviations (additive-only, documented):
//   - id/targetEntityId accept min(1) strings (not strict uuid): edge identity
//     vocabulary (Phase 023-031 precedent); strict uuid 400s valid LIFF sessions.
//   - DataScopeRoleEnum mirrors the Prisma enum 1:1 so guards never drift.
// - Mask helpers are the SINGLE source for backend interceptor + frontend
//   preview (BDD Scenario 2 vectors pinned in tests).
// - Zero new deps (zod only; node:crypto via lazy require, tax-contract precedent).
import { z } from 'zod';

export const SensitiveFieldTypeEnum = z.enum([
  'PHONE_NUMBER',
  'BANK_ACCOUNT',
  'NATIONAL_ID',
  'TAX_ID',
  'STREET_ADDRESS',
  'EMAIL_ADDRESS',
]);
export type SensitiveFieldType = z.infer<typeof SensitiveFieldTypeEnum>;

export const DataScopeLevelEnum = z.enum([
  'OWNER_ONLY',
  'TENANT_ADMIN',
  'FULFILLMENT_STAFF',
  'SYSTEM_AUDITOR',
  'PUBLIC_MASKED',
]);
export type DataScopeLevel = z.infer<typeof DataScopeLevelEnum>;

export const DataScopeRoleEnum = z.enum([
  'SUPER_ADMIN',
  'TENANT_ADMIN',
  'COMPLIANCE_OFFICER',
  'SUPPORT_STAFF',
  'FULFILLMENT_OPERATOR',
  'MEMBER',
]);
export type DataScopeRole = z.infer<typeof DataScopeRoleEnum>;

export const EncryptedFieldSchema = z.object({
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  keyVersion: z.number().int().positive(),
});
export type EncryptedField = z.infer<typeof EncryptedFieldSchema>;

export const MaskedUserPayloadSchema = z.object({
  id: z.string().min(1),
  displayName: z.string(),
  maskedPhone: z.string(),
  maskedBankAccount: z.string().nullable(),
  maskedIdCard: z.string().nullable(),
  dataScopeLevel: DataScopeLevelEnum,
});
export type MaskedUserPayload = z.infer<typeof MaskedUserPayloadSchema>;

export const UnmaskRequestSchema = z.object({
  targetEntityId: z.string().min(1),
  fieldType: SensitiveFieldTypeEnum,
  reason: z.string().min(5).max(255),
  liffAccessToken: z.string().optional(),
});
export type UnmaskRequest = z.infer<typeof UnmaskRequestSchema>;

/** Budgets + wires (Gate 4/8/10.1). */
export const PII_MASK_BUDGET_MS = 5;
export const PII_UNMASK_TTL_SEC = 30;
export const PII_UNMASK_MAX_PER_DAY = 50;
export const PII_AUDIT_STREAM = 'events:pii:access-audit';
export const PII_LIFF_RAM_MB = 30;

export function piiAuditKey(actorUserId: string, day: string): string {
  return `pii:unmask:{${actorUserId}}:${day}`;
}

function nodeCrypto(): {
  createHmac(a: string, s: string): { update(d: string): { digest(e: string): string } };
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto') as never;
}

/** Blind index: HMAC-SHA256 exact-match hash (never decrypt for search, §8.1). */
export function blindIndex(value: string, pepper: string): string {
  return nodeCrypto().createHmac('sha256', pepper).update(value).digest('hex');
}

/** BDD Scenario 2 vectors: "0812345678" -> "081-***-5678". */
export function maskPhone(value: string): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `${digits.slice(0, 3)}-***-${digits.slice(-4)}`;
  if (digits.length === 9) return `${digits.slice(0, 3)}-***-${digits.slice(-3)}`;
  return '***MASKED***';
}

/** "1234567890" -> "123-x-xxxxx-0" (BDD Scenario 2 shape: head kept, tail kept). */
export function maskBankAccount(value: string): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7) return '***MASKED***';
  return `${digits.slice(0, 3)}-x-xxxxx-${digits.slice(-1)}`;
}

export function maskIdCard(value: string): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  const m = digits.match(/^(\d{1})\d{9}(\d{3})$/);
  if (!m) return '***MASKED***';
  return `${m[1]}-xxxx-xxxxx-${m[2]}`;
}

export function maskEmail(value: string): string {
  if (!value) return '';
  const at = value.indexOf('@');
  if (at <= 1) return '***MASKED***';
  return `${value.slice(0, 2)}***${value.slice(at)}`;
}

export function maskAddress(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '***MASKED***';
  return `${value.slice(0, 6)}***${value.slice(-4)}`;
}

/** Single dispatch used by the interceptor (backend) and LIFF preview (frontend). */
export function maskByFieldType(value: string, fieldType: SensitiveFieldType): string {
  switch (fieldType) {
    case 'PHONE_NUMBER':
      return maskPhone(value);
    case 'BANK_ACCOUNT':
      return maskBankAccount(value);
    case 'NATIONAL_ID':
      return maskIdCard(value);
    case 'TAX_ID':
      return maskIdCard(value);
    case 'EMAIL_ADDRESS':
      return maskEmail(value);
    case 'STREET_ADDRESS':
      return maskAddress(value);
    default:
      return '***MASKED***';
  }
}

/** Roles that bypass masking (gatekeeper matrix §8.2: owner handled by caller). */
export function isUnmaskedRole(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'COMPLIANCE_OFFICER';
}
