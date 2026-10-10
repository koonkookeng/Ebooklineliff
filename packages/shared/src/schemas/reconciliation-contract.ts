// SSOT Phase 115 §3.1 — bank statement auto-reconciliation contract
// Canonical: packages/shared/src/schemas/reconciliation-contract.ts
// (legacy src/shared/schemas/reconciliation-contract.ts)
// - Spec-verbatim: ReconciliationStatusEnum (5) / StatementSourceEnum (4) /
//   MismatchReasonEnum (6) / BankStatementImportSchema /
//   ManualOverridePayloadSchema.
// - RISK_CALL deviations (additive-only, documented):
//   - statementId/orderId/checkerUserId accept min(1) edge vocabulary in
//     addition to uuid (Phase 023-031 precedent).
//   - rawPayload accepts any JSON value (spec z.record(z.unknown()) rejects
//     arrays; bank payloads are free-form).
// - Pure helpers: hashStatement (SHA-256 dedupe), windowBounds (per-account
//   tolerance override), makerCheckerRequired (>1000 THB), matchRate,
//   RECON budgets/keys. Zero new deps (node:crypto for hash + zod).
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const ReconciliationStatusEnum = z.enum([
  'UNMATCHED',
  'AUTO_MATCHED',
  'MANUAL_OVERRIDDEN',
  'DISCREPANCY_FLAGGED',
  'REJECTED_DUPLICATE',
]);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatusEnum>;

export const StatementSourceEnum = z.enum([
  'OPEN_BANKING_API',
  'BANK_WEBHOOK',
  'CSV_IMPORT',
  'SCRAPER_FEED',
]);
export type StatementSource = z.infer<typeof StatementSourceEnum>;

export const MismatchReasonEnum = z.enum([
  'EXACT_MATCH_FOUND',
  'AMOUNT_MISMATCH',
  'REF_NOT_FOUND',
  'EXPIRED_TIME_WINDOW',
  'DUPLICATE_TRANS_REF',
  'SUSPICIOUS_PATTERN',
]);
export type MismatchReason = z.infer<typeof MismatchReasonEnum>;

export const BankStatementImportSchema = z.object({
  bankCode: z.string().min(2).max(10),
  accountNumber: z.string().min(8).max(20),
  transRef: z.string().min(5),
  amount: z.number().positive(),
  txType: z.enum(['CREDIT', 'DEBIT']),
  txTimestamp: z.string().datetime(),
  senderBank: z.string().optional(),
  senderName: z.string().optional(),
  rawPayload: z.unknown(),
});
export type BankStatementImportInput = z.infer<typeof BankStatementImportSchema>;

export const ManualOverridePayloadSchema = z.object({
  statementId: z.string().min(1),
  orderId: z.string().min(1),
  overrideReason: z.string().min(10).max(500),
  adjustmentNote: z.string().max(500).optional(),
  checkerUserId: z.string().min(1).optional(),
});
export type ManualOverridePayload = z.infer<typeof ManualOverridePayloadSchema>;

/** Default auto-match time tolerance (minutes; per-account override wins). */
export const RECON_DEFAULT_TOLERANCE_MINS = 30;
/** Maker-checker dual control trips above 1,000 THB (BDD-2). */
export const MAKER_CHECKER_THRESHOLD_THB = 1000;
/** Auto-match SLA per statement (<500ms, BDD-1). */
export const RECON_MATCH_SLA_MS = 500;
/** Auto-match rate target (>99.2%, §1.1). */
export const RECON_AUTO_MATCH_TARGET_PCT = 99.2;
/** Reconciliation event stream (Gate 8, §7.1). */
export const RECON_STREAM = 'financial:reconciliation:events';

/** SHA-256 dedupe signature: transRef_amount_txTimestamp (spec §5.2). */
export function hashStatement(args: { transRef: string; amount: number; txTimestamp: string }): string {
  return createHash('sha256').update(`${args.transRef}_${args.amount}_${args.txTimestamp}`, 'utf8').digest('hex');
}

/** Time-window bounds around a statement timestamp (tolerance minutes). */
export function windowBounds(txTimestamp: Date | string, toleranceMins: number): { minTime: Date; maxTime: Date } {
  const t = new Date(txTimestamp).getTime();
  return { minTime: new Date(t - toleranceMins * 60000), maxTime: new Date(t + toleranceMins * 60000) };
}

/** Dual control required for overrides above 1,000 THB. */
export function makerCheckerRequired(amount: number): boolean {
  return amount > MAKER_CHECKER_THRESHOLD_THB;
}

/** Auto-match rate percentage (matched / total). */
export function autoMatchRate(matched: number, total: number): number {
  if (total <= 0) return 100;
  return Math.round((matched / total) * 1000) / 10;
}

/** SHA-256 audit chain step (§8.1): H_n = H(H_{n-1} | stmt | order | maker | ts). */
export function chainStep(prevHash: string, args: { statementId: string; orderId: string; initiatedBy: string; timestamp: string }): string {
  return createHash('sha256')
    .update(`${prevHash}|${args.statementId}|${args.orderId}|${args.initiatedBy}|${args.timestamp}`, 'utf8')
    .digest('hex');
}

export const RECON_GENESIS_HASH = 'GENESIS';

export function reconQueueKey(status: string, page: number): string {
  return `recon:queue:${status}:${page}`;
}
