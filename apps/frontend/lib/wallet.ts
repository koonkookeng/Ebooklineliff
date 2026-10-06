// SSOT Phase 017 §6 — Type-safe wallet fetcher (balance + ledger + one-click)
// Canonical: apps/frontend/lib/wallet.ts
// (legacy src/frontend/lib/wallet.ts + src/shared/graphql/wallet.queries)
import type {
  OneClickBuyResult,
  WalletBalanceResponse,
  WalletLedgerItem,
  WalletTopupResult,
} from '@repo/shared';

export type { OneClickBuyResult, WalletBalanceResponse, WalletLedgerItem, WalletTopupResult };

export const ONE_CLICK_BUY_MUTATION = /* GraphQL */ `
  mutation ExecuteOneClickBuy($productId: ID!, $expectedPrice: Float!) {
    executeOneClickBuy(productId: $productId, expectedPrice: $expectedPrice) {
      success
      orderId
      remainingBalance
    }
  }
`;

export async function fetchWalletBalance(): Promise<WalletBalanceResponse> {
  const res = await fetch('/api/wallet/balance', { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'โหลดยอดกระเป๋าเงินไม่สำเร็จ');
  }
  return (await res.json()) as WalletBalanceResponse;
}

export async function fetchWalletLedger(take = 20): Promise<WalletLedgerItem[]> {
  const res = await fetch(`/api/wallet/ledger?take=${take}`, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error('โหลดประวัติไม่สำเร็จ');
  return (await res.json()) as WalletLedgerItem[];
}

export async function executeOneClickBuy(productId: string, expectedPrice: number): Promise<OneClickBuyResult> {
  const res = await fetch('/api/wallet/one-click-buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, expectedPrice }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'เกิดข้อผิดพลาดในการซื้อสินค้า');
  }
  return (await res.json()) as OneClickBuyResult;
}

export async function previewTopupBonus(amount: number): Promise<{ amount: number; bonusAmount: number; total: number }> {
  const res = await fetch('/api/wallet/topup/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'คำนวณโบนัสไม่สำเร็จ');
  }
  return (await res.json()) as { amount: number; bonusAmount: number; total: number };
}

/** Masked display: shows first/last digit, masks middle two (spec §2.1). */
export function maskBalance(total: number): string {
  const s = total.toFixed(2);
  if (s.length <= 4) return '••';
  return `${s.slice(0, 1)}••${s.slice(-2)}`;
}
