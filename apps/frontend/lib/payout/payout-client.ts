// SSOT Phase 086 §2 — Payout clearing client (REST transport, SSE revalidate)
// Canonical: apps/frontend/lib/payout/payout-client.ts
// - Double-submit guard lives in the button (disabled + idempotency note);
//   the server mutex is the backstop. Balances revalidate via SSE/focus.
// - Zero-dep (fetch + EventSource only).
export type PayoutStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface SellerPayoutResult {
  success: boolean;
  payoutId: string;
  grossAmount: number;
  taxAmount: number;
  netAmount: number;
  status: string;
}

export interface ClearingQueueItem {
  id: string;
  userId: string;
  grossAmount: number;
  netTransferAmount: number;
  status: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`payout ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function payoutApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    request: (amount: number, bankAccountId: string, remark?: string) =>
      post(`/api/v1/payout/request?${qs}`, { amount, bankAccountId, ...(remark ? { remark } : {}) }) as Promise<SellerPayoutResult>,
    queue: () => json<ClearingQueueItem[]>(`/api/v1/payout/clearing-queue?${qs}`),
    approveBatch: (payoutIds: string[]) =>
      post(`/api/v1/payout/clearing-approve?${qs}`, { payoutIds }) as Promise<{ batchNo: string; cleared: string[]; transRef: string }>,
    financeStreamUrl: () => `/api/v1/finance/stream-balance?${qs}`,
  };
}

/** 3% preview mirrors the server (withholdingSplit). */
export function previewPayout(amount: number): { tax: number; net: number } {
  const tax = Math.round(amount * 0.03 * 100) / 100;
  return { tax, net: Math.round((amount - tax) * 100) / 100 };
}
