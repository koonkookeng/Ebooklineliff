// SSOT Phase 081 §3.1 — Real-time finance & double-entry ledger contract
// Canonical: packages/shared/src/schemas/finance-contract.ts
// (legacy src/shared/schemas/finance-contract.ts — did not exist; new SSOT)
// - Spec-verbatim: LedgerAccountTypeEnum / TransactionEntryTypeEnum /
//   LedgerEntrySchema / CommissionSplitSchema / PayoutResponseSchema (§3.1).
// - RISK_CALL deviations (additive-only, documented):
//   (a) PayoutStatusEnum is owned by affiliate-contract.ts → this module
//       exports FinancePayoutStatusEnum (081 values) to avoid a barrel
//       collision (071 alias precedent);
//   (b) PayoutRequestSchema is owned by merchant-contract.ts → this module
//       exports FinancePayoutRequestSchema (081 §3.1 shape);
//   (c) money attribution writes stay in 026/079 — this contract owns
//       ledger math (splits, tax, balance equation) only.
// - Pure helpers (cents-integer math, no float drift): splitRevenue
//   (BDD-1: 1000 → fee 50 / t1 100 / t2 20 / seller 830), withholdingSplit
//   (3% §8.2), balance equation assert, Redis key builders, stream names.
// - Zero new deps (zod only).
import { z } from 'zod';

export const LedgerAccountTypeEnum = z.enum([
  'CASH_EQUIVALENT',
  'SELLER_PAYABLE',
  'AFFILIATE_PAYABLE',
  'PLATFORM_REVENUE_FEE',
  'WITHHOLDING_TAX_PAYABLE',
  'ESCROW_HOLD',
]);
export type LedgerAccountType = z.infer<typeof LedgerAccountTypeEnum>;

export const TransactionEntryTypeEnum = z.enum(['DEBIT', 'CREDIT']);
export type TransactionEntryType = z.infer<typeof TransactionEntryTypeEnum>;

export const FinancePayoutStatusEnum = z.enum([
  'REQUESTED',
  'PROCESSING_BANK',
  'SUCCESS',
  'FAILED',
  'REJECTED',
  // Atomic Phase 086: bank-clearing lifecycle (additive; 081 rows unaffected).
  // REQUESTED ≡ PENDING_APPROVAL at creation (single canonical record).
  'PENDING_APPROVAL',
  'FAILED_BANK_TRANSFER',
]);
export type FinancePayoutStatus = z.infer<typeof FinancePayoutStatusEnum>;

export const LedgerEntrySchema = z.object({
  journalId: z.string().uuid(),
  accountId: z.string().uuid(),
  accountType: LedgerAccountTypeEnum,
  entryType: TransactionEntryTypeEnum,
  amount: z.number().positive(),
  currency: z.string().default('THB'),
  description: z.string(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const CommissionSplitSchema = z.object({
  orderId: z.string().uuid(),
  grossAmount: z.number().positive(),
  platformFeeAmount: z.number().min(0),
  sellerNetAmount: z.number().positive(),
  affiliateTier1Amount: z.number().min(0).optional(),
  affiliateTier2Amount: z.number().min(0).optional(),
});
export type CommissionSplit = z.infer<typeof CommissionSplitSchema>;

export const FinancePayoutRequestSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().uuid(),
  requestedAmount: z.number().min(100, 'Minimum payout is 100 THB'),
  bankAccountId: z.string().uuid(),
});
export type FinancePayoutRequest = z.infer<typeof FinancePayoutRequestSchema>;

export const PayoutResponseSchema = z.object({
  payoutId: z.string().uuid(),
  grossAmount: z.number(),
  withholdingTaxAmount: z.number(),
  netTransferAmount: z.number(),
  status: FinancePayoutStatusEnum,
  createdAt: z.string(),
});
export type PayoutResponse = z.infer<typeof PayoutResponseSchema>;

/** Platform fee default: 5.0% (BDD-1). */
export const FINANCE_PLATFORM_FEE_DEFAULT = 5;
/** Affiliate tier defaults: 10% / 2% (BDD-1, CommissionRule card). */
export const FINANCE_TIER1_DEFAULT = 10;
export const FINANCE_TIER2_DEFAULT = 2;
/** e-Withholding tax: 3% (§8.2,มาตรา 40(2)). */
export const FINANCE_WITHHOLDING_TAX_RATE = 0.03;
/** Payout floor: 100 THB (§3.1). */
export const FINANCE_PAYOUT_MIN_THB = 100;
/** Wallet broadcast stream (Gate 6, <300ms). */
export const FINANCE_WALLET_STREAM = 'finance:wallet:updates';
/** Journal posted stream (Gate 8). */
export const FINANCE_JOURNAL_STREAM = 'finance:journal:posted';
/** Payout event stream. */
export const FINANCE_PAYOUT_STREAM = 'finance:payout:events';

const toCents = (thb: number): number => Math.round(thb * 100);
const toThb = (cents: number): number => cents / 100;

/**
 * BDD-1 revenue split (cents-exact): seller takes the remainder so
 * gross == fee + t1 + t2 + sellerNet holds by construction.
 * 1000 @ 5/10/2 → { fee: 50, t1: 100, t2: 20, sellerNet: 830 }.
 */
export function splitRevenue(
  grossAmount: number,
  rates: { platformFeePercent: number; tier1Percent?: number; tier2Percent?: number },
): { platformFeeAmount: number; affiliateTier1Amount: number; affiliateTier2Amount: number; sellerNetAmount: number } {
  const gross = toCents(grossAmount);
  const fee = Math.round((gross * rates.platformFeePercent) / 100);
  const t1 = Math.round((gross * (rates.tier1Percent ?? 0)) / 100);
  const t2 = Math.round((gross * (rates.tier2Percent ?? 0)) / 100);
  return {
    platformFeeAmount: toThb(fee),
    affiliateTier1Amount: toThb(t1),
    affiliateTier2Amount: toThb(t2),
    sellerNetAmount: toThb(gross - fee - t1 - t2),
  };
}

/** 3% withholding split: 5000 → { tax: 150, net: 4850 } (BDD-2). */
export function withholdingSplit(grossAmount: number): { tax: number; net: number } {
  const tax = Math.round(grossAmount * FINANCE_WITHHOLDING_TAX_RATE * 100) / 100;
  return { tax, net: Math.round((grossAmount - tax) * 100) / 100 };
}

/** Double-entry equation guard (§8.1): gross == seller + fee + t1 + t2. */
export function assertBalanced(split: {
  grossAmount: number;
  platformFeeAmount: number;
  sellerNetAmount: number;
  affiliateTier1Amount?: number;
  affiliateTier2Amount?: number;
}): void {
  const rhs =
    toCents(split.sellerNetAmount) +
    toCents(split.platformFeeAmount) +
    toCents(split.affiliateTier1Amount ?? 0) +
    toCents(split.affiliateTier2Amount ?? 0);
  if (toCents(split.grossAmount) !== rhs) {
    throw new Error('Double-entry balance mismatch error');
  }
}

/** Human payout number: FP-<tenant-slice>-<base36 time>. */
export function financePayoutNo(tenantId: string, at = Date.now()): string {
  const slice = tenantId.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase().padEnd(3, 'X');
  return `FP-${slice}-${at.toString(36).toUpperCase()}`;
}

/** Tax certificate number: TX-<year>-<base36 time>. */
export function taxCertificateNo(at = Date.now()): string {
  return `TX-${new Date(at).getFullYear()}-${at.toString(36).toUpperCase()}`;
}

/** Redis live-balance key (Gate 6). */
export function financeBalanceKey(userId: string): string {
  return `finance:balance:${userId}`;
}

/** Redis payout mutex key (double-withdrawal guard, BDD-2). */
export function financePayoutLockKey(userId: string): string {
  return `finance:payout:lock:${userId}`;
}
