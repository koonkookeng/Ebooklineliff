// SSOT Phase 118 §3.1 — immutable audit log contract
// Canonical: packages/shared/src/schemas/audit-log.schema.ts
// - Spec-verbatim vocabularies: AuditAdminRoleEnum (6) /
//   AuditActionCategoryEnum (6) / AuditIntegrityStatusEnum (4) /
//   AuditLogEntry / AuditIntegrityCheckResult.
// - RISK_CALL deviations (additive-only, documented):
//   - ids accept min(1) edge vocabulary in addition to uuid (023-031
//     precedent); sequenceNumber accepts number|bigint (JSON-safe number
//     on the wire, BigInt in Prisma).
//   - payloads accept any JSON value (spec z.record(z.any()) rejects arrays
//     and z.record(z.unknown()) rejects arrays too; audit payloads are
//     free-form).
// - Pure crypto (node:crypto): auditBlockHash (spec §5.2 formula),
//   signAuditHash / verifyAuditSignature (HMAC-SHA256, timing-safe),
//   auditVaultKey (WORM layout). Budgets: <2ms/block append (Gate 5),
//   1000-block WORM batches, 7-year retention tag.
// - Zero new deps (zod + node:crypto only).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const AuditAdminRoleEnum = z.enum([
  'SUPER_ADMIN',
  'FINANCE_ADMIN',
  'CONTENT_MODERATOR',
  'SUPPORT_STAFF',
  'INSTRUCTOR',
  'SELLER',
]);
export type AuditAdminRole = z.infer<typeof AuditAdminRoleEnum>;

export const AuditActionCategoryEnum = z.enum([
  'AUTHENTICATION',
  'USER_MANAGEMENT',
  'FINANCIAL_TRANSACTION',
  'CONTENT_MUTATION',
  'SYSTEM_CONFIGURATION',
  'ENTITLEMENT_GRANT',
]);
export type AuditActionCategory = z.infer<typeof AuditActionCategoryEnum>;

export const AuditIntegrityStatusEnum = z.enum([
  'VERIFIED_VALID',
  'PENDING_VAULT_SYNC',
  'TAMPER_DETECTED',
  'CORRUPTED_CHAIN',
]);
export type AuditIntegrityStatus = z.infer<typeof AuditIntegrityStatusEnum>;

export const AuditLogEntrySchema = z.object({
  id: z.string().min(1),
  sequenceNumber: z.union([z.number().int().positive(), z.bigint()]),
  actorId: z.string().min(1),
  actorRole: AuditAdminRoleEnum,
  actorEmail: z.string().email(),
  ipAddress: z.string().min(1),
  userAgent: z.string().min(1),
  actionCategory: AuditActionCategoryEnum,
  actionName: z.string().min(1),
  targetEntity: z.string().min(1),
  targetEntityId: z.string().min(1).optional(),
  payloadBeforeJson: z.unknown().nullable(),
  payloadAfterJson: z.unknown().nullable(),
  previousHash: z.string().length(64),
  currentHash: z.string().length(64),
  signature: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export const AuditIntegrityCheckResultSchema = z.object({
  totalBlocksChecked: z.number().int().nonnegative(),
  isValid: z.boolean(),
  tamperedBlockSequences: z.array(z.number().int()),
  checkedAt: z.string().datetime(),
  vaultSyncStatus: z.enum(['IN_SYNC', 'OUT_OF_SYNC']),
});
export type AuditIntegrityCheckResult = z.infer<typeof AuditIntegrityCheckResultSchema>;

/** 118 §10.1: hash-chain append costs <2ms per block (Gate 5). */
export const AUDIT_APPEND_BUDGET_MS = 2;
/** 118 §8.1: WORM batch stride (blocks per Parquet/NDJSON object). */
export const AUDIT_WORM_BATCH_SIZE = 1000;
/** 118 §8.1: Compliance Lock retention (7 years, days). */
export const AUDIT_WORM_RETENTION_DAYS = 7 * 365;
/** Daily integrity cron cadence (BDD-2). */
export const AUDIT_CRON_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Audit event stream (Gate 8). */
export const AUDIT_EVENT_STREAM = 'stream:audit:events';

export const AUDIT_GENESIS_HASH = '0'.repeat(64);

const stable = (v: unknown): string => JSON.stringify(v ?? {});

/**
 * Spec §5.2 block formula:
 * SHA-256(seq|actor|action|before|after|prev|ts).
 */
export function auditBlockHash(args: {
  sequenceNumber: number | bigint;
  actorId: string;
  actionName: string;
  payloadBefore: unknown;
  payloadAfter: unknown;
  previousHash: string;
  timestamp: string;
}): string {
  const raw = `${String(args.sequenceNumber)}|${args.actorId}|${args.actionName}|${stable(args.payloadBefore)}|${stable(args.payloadAfter)}|${args.previousHash}|${args.timestamp}`;
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** HMAC-SHA256 block signature (env-first secret, explicit fallback). */
export function signAuditHash(currentHash: string, secret: string): string {
  return createHmac('sha256', secret).update(currentHash, 'utf8').digest('hex');
}

/** Timing-safe signature verification (length-guarded). */
export function verifyAuditSignature(currentHash: string, signature: string, secret: string): boolean {
  const expected = signAuditHash(currentHash, secret);
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

/** WORM object layout: audit-worm/YYYY/MM/<seq>.ndjson (zero egress). */
export function auditVaultKey(sequenceNumber: number | bigint, at: Date | string): string {
  const d = new Date(at);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `audit-worm/${y}/${m}/${String(sequenceNumber)}.ndjson`;
}

export function auditQueueKey(status: string, page: number): string {
  return `audit:queue:${status}:${page}`;
}
