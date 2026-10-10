// SSOT Phase 114 §3.1 — financial clearinghouse contract
// Canonical: packages/shared/src/schemas/clearinghouse-contract.ts
// (legacy src/shared/schemas/clearinghouse-contract.ts)
// - Spec values verbatim: 7 ledger accounts / DEBIT+CREDIT / 5 payout states /
//   ledger entry / payout request (100 THB floor) / 3% tax calc.
// - RISK_CALL deviations (additive-only, documented):
//   - `Clearinghouse*` names: finance-contract.ts already owns
//     LedgerAccountType/TransactionEntryType/LedgerEntry (081) in the barrel —
//     same values would collide, so 114 exports aliases (111/081 precedent).
//   - orderId/sellerId/bankAccountId accept min(1) edge vocabulary in
//     addition to uuid (Phase 023-031 precedent).
//   - Settlement math is 114-local (70/10/20 creator/affiliate/platform):
//     081 splitRevenue is tier1/tier2 vocabulary — different lane. Tax math
//     delegates to 082 calculate3PercentWithholding (single source, §9).
// - Pure helpers (cents-exact): splitSettlement, assertSettlementBalanced,
//   availablePayout, forecastNet (§7.2), keys. Budgets: 100ms summary,
//   50ms/item reconcile, 0.01 THB drift trip, 100 THB payout floor.
// - Zero new deps (zod only).
import { z } from 'zod';

export const ClearinghouseLedgerAccountEnum = z.enum([
  'CASH_ASSET',
  'ESCROW_LIABILITY',
  'PLATFORM_REVENUE',
  'CREATOR_PAYABLE',
  'AFFILIATE_PAYABLE',
  'TAX_WITHHOLDING_PAYABLE',
  'REFUND_RESERVE',
]);
export type ClearinghouseLedgerAccount = z.infer<typeof ClearinghouseLedgerAccountEnum>;

export const ClearinghouseEntryTypeEnum = z.enum(['DEBIT', 'CREDIT']);
export type ClearinghouseEntryType = z.infer<typeof ClearinghouseEntryTypeEnum>;

export const ClearinghousePayoutStatusEnum = z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED']);
export type ClearinghousePayoutStatus = z.infer<typeof ClearinghousePayoutStatusEnum>;

export const ClearinghouseLedgerEntrySchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  orderId: z.string().min(1).optional(),
  accountType: ClearinghouseLedgerAccountEnum,
  entryType: ClearinghouseEntryTypeEnum,
  amount: z.number().positive(),
  description: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type ClearinghouseLedgerEntry = z.infer<typeof ClearinghouseLedgerEntrySchema>;

export const SellerPayoutRequestSchema = z.object({
  sellerId: z.string().min(1),
  requestedAmount: z.number().min(100, 'Minimum payout is 100 THB'),
  bankAccountId: z.string().min(1),
});
export type SellerPayoutRequest = z.infer<typeof SellerPayoutRequestSchema>;

export const ClearinghouseTaxCalcSchema = z.object({
  grossAmount: z.number().positive(),
  taxRatePercent: z.number().default(3.0),
  taxAmount: z.number().min(0),
  netAmount: z.number().min(0),
});
export type ClearinghouseTaxCalc = z.infer<typeof ClearinghouseTaxCalcSchema>;

/** Default 70/10/20 revenue split (spec §5.1) when no tenant rule exists. */
export const SETTLEMENT_DEFAULTS = {
  platformFeePercent: 20,
  creatorSharePercent: 70,
  affiliateSharePercent: 10,
} as const;

/** 114 §1.3 BDD: summary refreshes in real time within 100ms. */
export const CLEARINGHOUSE_SUMMARY_BUDGET_MS = 100;
/** 114 §10.1: reconciliation under 50ms per item. */
export const RECONCILE_BUDGET_MS_PER_ITEM = 50;
/** 114 §7.1: drift above 0.01 THB trips DISCREPANCY_HOLD. */
export const RECONCILE_DRIFT_TRIP_THB = 0.01;
// Minimum automated payout reuses PAYOUT_MIN_THB (100, affiliate-contract) —
// same floor, no second constant.
/** Standard e-withholding rate (delegated to 082 calculator). */
export const WITHHOLDING_RATE_PERCENT = 3.0;
/** Clearinghouse event stream (Gate 8). */
export const CLEARINGHOUSE_STREAM = 'stream:clearinghouse:events';

const toCents = (thb: number): number => Math.round(thb * 100);
const toThb = (cents: number): number => cents / 100;

export interface SettlementSplit {
  grossAmount: number;
  platformFeeAmount: number;
  creatorAmount: number;
  affiliateAmount: number;
}

/**
 * Cents-exact 3-way split; the platform leg takes the rounding remainder so
 * gross == platform + creator + affiliate holds by construction.
 */
export function splitSettlement(
  grossAmount: number,
  rule?: { platformFeePercent: number; creatorSharePercent: number; affiliateSharePercent: number },
): SettlementSplit {
  if (!(grossAmount > 0)) throw new Error('Gross amount must be positive');
  const r = rule ?? SETTLEMENT_DEFAULTS;
  const gross = toCents(grossAmount);
  const creator = Math.round((gross * r.creatorSharePercent) / 100);
  const affiliate = Math.round((gross * r.affiliateSharePercent) / 100);
  const platform = gross - creator - affiliate;
  if (platform < 0) throw new Error('Rule percentages exceed 100%');
  return { grossAmount: toThb(gross), platformFeeAmount: toThb(platform), creatorAmount: toThb(creator), affiliateAmount: toThb(affiliate) };
}

/**
 * Gate 5 double-entry guard: ΣDEBIT ≡ ΣCREDIT per settlement batch.
 * The batch MUST include the ESCROW clearing debit (spec §5.2 omits it;
 * without it debits 1000 ≠ credits 2000 and the invariant cannot hold).
 */
export function assertSettlementBalanced(entries: Array<{ entryType: 'DEBIT' | 'CREDIT'; amount: number }>): void {
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    if (e.entryType === 'DEBIT') debit += toCents(e.amount);
    else credit += toCents(e.amount);
  }
  if (debit !== credit || debit === 0) {
    throw new Error('Double-entry balance mismatch error');
  }
}

/** Settled balance available for automated payout (released − open − paid). */
export function availablePayout(args: { releasedNet: number; openPayouts: number; completedPayouts: number }): number {
  return Math.round((args.releasedNet - args.openPayouts - args.completedPayouts) * 100) / 100;
}

/** §7.2 net projected cashflow: Σgross×(1−refundRate) − payable − tax. */
export function forecastNet(args: { grossTotal: number; refundRate: number; payoutPayable: number; taxWithholding: number }): number {
  return Math.round((args.grossTotal * (1 - args.refundRate) - args.payoutPayable - args.taxWithholding) * 100) / 100;
}

export function clearingQueueKey(tenantId: string, page: number): string {
  return `clearing:ledger:${tenantId}:${page}`;
}

export function discrepancyKey(orderId: string): string {
  return `clearing:discrepancy:${orderId}`;
}
