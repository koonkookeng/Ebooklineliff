// SSOT Phase 017 §5 — Bonus & cashback calculation rules engine (pure, testable)
// Canonical: apps/backend/src/modules/wallet/domain/wallet-calculator.ts
import { WALLET_TOPUP_BONUS_RATE } from '@repo/shared';

/** 10% campaign bonus, satang-rounded. Override rate for personalized offers. */
export function topupBonus(amount: number, rate = WALLET_TOPUP_BONUS_RATE): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * rate * 100) / 100;
}

/** Total credited on top-up (principal + bonus). */
export function topupTotal(amount: number, rate = WALLET_TOPUP_BONUS_RATE): number {
  return Math.round((amount + topupBonus(amount, rate)) * 100) / 100;
}

/** Multi-tier affiliate cashback (tier1 10% / tier2 3% / tier3 1%). */
export function affiliateReward(netAmount: number, tier: 1 | 2 | 3): number {
  const rate = tier === 1 ? 0.1 : tier === 2 ? 0.03 : 0.01;
  return Math.round(netAmount * rate * 100) / 100;
}
