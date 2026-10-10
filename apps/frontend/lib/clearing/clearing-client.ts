// SSOT Phase 114 §2 — clearinghouse client (REST transport)
// Canonical: apps/frontend/lib/clearing/clearing-client.ts
// - BigNumber-safe 2-decimal formatting (FINANCIAL_ACCURACY_UI §2.1).
// - Zero-dep (fetch only).
export type ClearingUiState = 'FIN_INIT' | 'IDLE' | 'RECONCILING' | 'SETTLED' | 'DISPUTE_HOLD' | 'ERROR';

export interface FinancialSummaryView {
  totalGrossCashflow: number;
  totalEscrowHeld: number;
  totalPlatformRevenue: number;
  totalCreatorPayable: number;
  totalAffiliatePayable?: number;
  totalTaxWithheld: number;
  totalRefunded?: number;
  unreconciledDiscrepanciesCount?: number;
}

export interface LedgerRowView {
  id: string;
  accountType: string;
  entryType: string;
  amount: number;
  description: string;
  createdAt: string;
  orderId?: string | null;
  payoutId?: string | null;
}

export interface PayoutResultView {
  payoutId: string;
  sellerId: string;
  grossAmount: number;
  taxAmount: number;
  netPayoutAmount: number;
  status: string;
  taxCertificateUrl: string | null;
  executedAt: string;
}

export interface SellerBalanceView {
  releasedNet: number;
  openPayouts: number;
  completedPayouts: number;
  available: number;
}

/** BigNumber 2-decimal THB formatting (string-safe for large sums). */
export function formatThb(amount: number | string): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '฿0.00';
  return `฿${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`clearinghouse ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function clearingApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    summary: () => json<FinancialSummaryView>(`/api/v1/admin/clearing/summary?${qs}`),
    ledger: (limit = 20, offset = 0) =>
      json<LedgerRowView[]>(`/api/v1/admin/clearing/ledger?${qs}&limit=${limit}&offset=${offset}`),
    settle: (orderId: string) => post(`/api/v1/admin/clearing/settle?${qs}`, { orderId }),
    reconcile: (lines: Array<{ orderId: string; amount: number; transRef?: string }>) =>
      post(`/api/v1/admin/clearing/reconcile?${qs}`, { lines }) as Promise<{ matched: number; discrepancies: Array<{ orderId: string; drift: number }> }>,
    requestPayout: (body: { sellerId: string; requestedAmount: number; bankAccountId: string }) =>
      post(`/api/v1/creator/payout/request?${qs}`, body) as Promise<PayoutResultView>,
    sellerBalance: () => json<SellerBalanceView>(`/api/v1/creator/payout/balance?${qs}`),
  };
}
