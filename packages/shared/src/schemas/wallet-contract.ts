// SSOT Phase 017 §3.1 — Internal Wallet (Meb-Killer Credits) Zod domain contract
// Canonical: packages/shared/src/schemas/wallet-contract.ts
// (legacy src/shared/schemas/wallet-contract.ts)
import { z } from 'zod';

export const LedgerTypeEnum = z.enum([
  'TOPUP_CREDIT',
  'BONUS_CREDIT',
  'PURCHASE_DEBIT',
  'REFUND_CREDIT',
  'AFFILIATE_REWARD_CREDIT',
  'CASHBACK_CREDIT',
  'ADMIN_ADJUSTMENT',
]);
export type LedgerType = z.infer<typeof LedgerTypeEnum>;

export const WalletTopupInputSchema = z.object({
  amount: z.number().positive().min(20, 'ขั้นต่ำในการเติมเงินคือ 20 บาท'),
  promotionCode: z.string().max(64).optional(),
});
export type WalletTopupInput = z.infer<typeof WalletTopupInputSchema>;

export const OneClickBuyInputSchema = z.object({
  productId: z.string().uuid(),
  tenantId: z.string().min(1),
  expectedPrice: z.number().positive(),
});
export type OneClickBuyInput = z.infer<typeof OneClickBuyInputSchema>;

export const WalletBalanceResponseSchema = z.object({
  walletId: z.string().uuid(),
  mainBalance: z.number().min(0),
  bonusBalance: z.number().min(0),
  totalBalance: z.number().min(0),
  currency: z.string().default('THB'),
});
export type WalletBalanceResponse = z.infer<typeof WalletBalanceResponseSchema>;

export const WalletLedgerItemSchema = z.object({
  id: z.string().uuid(),
  type: LedgerTypeEnum,
  amount: z.number(),
  balanceAfter: z.number(),
  description: z.string(),
  referenceId: z.string().nullable(),
  createdAt: z.string(),
});
export type WalletLedgerItem = z.infer<typeof WalletLedgerItemSchema>;

export const OneClickBuyResultSchema = z.object({
  success: z.boolean(),
  orderId: z.string().uuid(),
  remainingBalance: z.number().min(0),
});
export type OneClickBuyResult = z.infer<typeof OneClickBuyResultSchema>;

export const WalletTopupResultSchema = z.object({
  success: z.boolean(),
  walletId: z.string().uuid(),
  creditedAmount: z.number().positive(),
  bonusAmount: z.number().min(0),
  totalBalance: z.number().min(0),
  transRef: z.string().nullable().default(null),
});
export type WalletTopupResult = z.infer<typeof WalletTopupResultSchema>;

/** Redis wallet mutex: 5s owner-TTL (spec §5.2), refreshed per attempt. */
export const WALLET_LOCK_TTL_SEC = 5;
/** Wallet lock key namespace (per-user mutual exclusion). */
export function walletLockKey(userId: string): string {
  return `wallet:lock:${userId}`;
}
/** Default top-up campaign bonus (10% — spec §BDD scenario 2). */
export const WALLET_TOPUP_BONUS_RATE = 0.1;
