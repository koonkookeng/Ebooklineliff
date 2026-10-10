// SSOT Phase 116 §2 — executive BI client (REST transport)
// Canonical: apps/frontend/lib/analytics/executive-bi-client.ts
// - Range presets + KPI/cohort/breakdown/snapshot reads. Numbers stay numeric
//   (2-decimal formatting at render). Zero-dep (fetch only).
export type BiUiState = 'DASHBOARD_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export type BiRange = 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'THIS_MONTH' | 'LAST_MONTH';

export interface ExecutiveKpiView {
  gmv: number;
  netRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  customerAcquisitionCost: number;
  customerLifetimeValue: number;
  churnRatePercentage: number;
  activeUsersCount: number;
  gmvGrowthPercentage: number;
  ltvToCacRatio: number;
  calculatedAt: string;
}

export interface CohortRowView {
  cohortDate: string;
  totalUsers: number;
  retentionRates: Array<{ periodIndex: number; activePercentage: number; retainedUsers: number }>;
}

export interface RevenueBreakdownView {
  physicalBook: number;
  ebook: number;
  course: number;
  bundle: number;
}

/** 2-decimal THB for KPI cards (string-safe). */
export function formatBiThb(amount: number | string): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '฿0.00';
  return `฿${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`executive-bi ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function executiveBiApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    summary: (timeRange: BiRange) => json<ExecutiveKpiView>(`/api/v1/admin/bi/summary?${qs}&timeRange=${timeRange}`),
    cohort: (months = 6) => json<CohortRowView[]>(`/api/v1/admin/bi/cohort?${qs}&months=${months}`),
    breakdown: (timeRange: BiRange) => json<RevenueBreakdownView>(`/api/v1/admin/bi/breakdown?${qs}&timeRange=${timeRange}`),
    snapshotRun: (date?: string) => post(`/api/v1/admin/bi/snapshot-run?${qs}`, date ? { date } : {}) as Promise<{ built: number; failed: number }>,
  };
}
