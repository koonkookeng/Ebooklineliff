// SSOT Phase 115 §2 — reconciliation client (REST transport)
// Canonical: apps/frontend/lib/reconciliation/reconciliation-client.ts
// - Split-pane data dense workspace reads; mutations always online.
// - Zero-dep (fetch only).
export type ReconUiState =
  | 'RECON_IDLE'
  | 'STATEMENT_MATCHING'
  | 'DISCREPANCY_DETECTED'
  | 'OVERRIDE_PENDING_CHECKER'
  | 'OVERRIDE_SUCCESS'
  | 'ERROR';

export interface BankStatementView {
  id: string;
  transRef: string | null;
  amount: number;
  txTimestamp: string;
  senderName: string | null;
  status: string;
  mismatchReason: string | null;
  matchedOrderId: string | null;
  matchedOrderNumber?: string;
}

export interface ReconKpiView {
  totalStatementsCount: number;
  autoMatchedRatePercentage: number;
  totalMatchedAmount: number;
  pendingDiscrepanciesCount: number;
  manualOverriddenCount: number;
}

export interface OverrideInitiatedView {
  overrideId: string;
  statementId: string;
  orderId: string;
  needsChecker: boolean;
  auditHash: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`reconciliation ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function reconApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    statements: (params?: { status?: string; page?: number; limit?: number }) => {
      const q = new URLSearchParams({ tenant: slug });
      if (params?.status) q.set('status', params.status);
      q.set('page', String(params?.page ?? 1));
      q.set('limit', String(params?.limit ?? 50));
      return json<BankStatementView[]>(`/api/v1/admin/reconciliation/statements?${q.toString()}`);
    },
    kpi: () => json<ReconKpiView>(`/api/v1/admin/reconciliation/kpi?${qs}`),
    verifyChain: () => json<{ valid: boolean; checked: number; brokenAt?: number }>(`/api/v1/admin/reconciliation/verify-chain?${qs}`),
    initiate: (body: { statementId: string; orderId: string; overrideReason: string; adjustmentNote?: string }) =>
      post(`/api/v1/admin/reconciliation/initiate?${qs}`, body) as Promise<OverrideInitiatedView>,
    approve: (body: { overrideId: string; checkerUserId?: string }) =>
      post(`/api/v1/admin/reconciliation/approve?${qs}`, body) as Promise<boolean>,
  };
}
