// SSOT Phase 081 §6 — Finance client (REST transport + SSE stream)
// Canonical: apps/frontend/lib/finance/finance-client.ts
// - Proxied REST (auth passthrough); SSE for live balances with polling
//   fallback (no socket.io dep — RAM <30MB, 057 SSE precedent).
// - Zero-dep (fetch + EventSource only).
export type FinanceStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface FinancialOverview {
  withdrawableBalance: number;
  pendingEscrowBalance: number;
  totalEarnedLifetime: number;
  totalCommissionPaid: number;
  taxWithheldLifetime: number;
}

export interface LedgerStatementItem {
  id: string;
  createdAt: string;
  description: string;
  debitAmount: number | null;
  creditAmount: number | null;
  runningBalance: number;
  referenceOrderId: string | null;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`finance ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function financeApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  return {
    overview: () => json<FinancialOverview>(`/api/v1/finance/overview?${qs}`),
    statements: (limit = 20, offset = 0) =>
      json<{ items: LedgerStatementItem[]; totalCount: number; hasMore: boolean }>(
        `/api/v1/finance/statements?${qs}&limit=${limit}&offset=${offset}`,
      ),
    payout: (body: unknown) =>
      json<{ payoutId: string; grossAmount: number; taxAmount: number; netAmount: number; status: string }>(
        `/api/v1/finance/payout?${qs}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      ),
    streamUrl: () => `/api/v1/finance/stream-balance?${qs}`,
  };
}

/** 3% preview math mirrors the server (withholdingSplit). */
export function previewWithholding(amount: number): { tax: number; net: number } {
  const tax = Math.round(amount * 0.03 * 100) / 100;
  return { tax, net: Math.round((amount - tax) * 100) / 100 };
}
