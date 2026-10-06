// SSOT Phase 017 §5 — Wallet domain aggregate root (bonus-first debit, never-negative)
// Canonical: apps/backend/src/modules/wallet/domain/wallet.entity.ts
// (legacy src/backend/modules/wallet/domain/wallet.entity.ts)
export interface WalletRow {
  id: string;
  userId: string;
  mainBalance: unknown;
  bonusBalance: unknown;
  isLocked: boolean;
}

export function toNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v !== null && typeof v === 'object' && 'toNumber' in (v as Record<string, unknown>)) {
    try {
      return (v as { toNumber(): number }).toNumber() ?? fallback;
    } catch {
      return fallback;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function totalOf(main: number, bonus: number): number {
  return Math.round((main + bonus) * 100) / 100;
}

/** Bonus-first debit split. Throws when funds are insufficient. */
export function debitSplit(main: number, bonus: number, price: number): { newMain: number; newBonus: number } {
  if (price <= 0) throw new Error('Invalid debit amount');
  if (totalOf(main, bonus) < price) throw new Error('ยอดเงินในกระเป๋าไม่เพียงพอ กรุณาเติมเงิน');
  let remaining = price;
  let newBonus = bonus;
  let newMain = main;
  if (newBonus >= remaining) {
    newBonus = Math.round((newBonus - remaining) * 100) / 100;
    remaining = 0;
  } else {
    remaining = Math.round((remaining - newBonus) * 100) / 100;
    newBonus = 0;
    newMain = Math.round((newMain - remaining) * 100) / 100;
  }
  if (newMain < 0 || newBonus < 0) throw new Error('ยอดเงินติดลบ (Negative Balance Boundary Violation)');
  return { newMain, newBonus };
}

export function assertUsable(wallet: Record<string, unknown> | WalletRow | null): asserts wallet is WalletRow {
  const row = wallet as (WalletRow & { id?: unknown }) | null;
  if (!row || typeof row.id !== 'string') throw new Error('กระเป๋าเงินถูกระงับหรือไม่พบข้อมูล');
  if (row.isLocked) throw new Error('กระเป๋าเงินถูกระงับหรือไม่พบข้อมูล');
}

/** PII-safe ledger description (no account numbers, no phone). */
export function purchaseDescription(productId: string): string {
  return `ชำระเงิน One-Click Buy สำหรับสินค้า ID: ${productId}`;
}
