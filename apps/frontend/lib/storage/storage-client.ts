// SSOT Phase 123 §2 — storage console client (REST transport)
// Canonical: apps/frontend/lib/storage/storage-client.ts
// - Admin console reads + mutations; always online (no offline queue for
//   billing data). 5-state machine owned by the dashboard component.
// - Zero-dep (fetch only).
export type StorageUiState = 'INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface StorageMetricView {
  totalSizeBytes: number;
  totalObjectsCount: number;
  classAOperationsCount: number;
  classBOperationsCount: number;
  estimatedMonthlyCostTHB: number;
  recordedAt: string;
}

export interface LifecycleRuleView {
  ruleId: string;
  prefix: string;
  enabled: boolean;
  expireDays: number | null;
  abortIncompleteMultipartDays: number;
  description: string | null;
}

export interface StorageBudgetView {
  tenantId: string;
  monthlyBudgetLimitTHB: number;
  warningThresholdPercent: number;
  criticalThresholdPercent: number;
  notifyLineUserIds: string[];
  autoPurgeTempOnExceed: boolean;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`storage ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function storageApi(tenant: string, bucket: string) {
  const qs = `tenant=${encodeURIComponent(tenant)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    metrics: () => json<StorageMetricView>(`/api/v1/admin/storage/metrics?${qs}`),
    rules: () => json<LifecycleRuleView[]>(`/api/v1/admin/storage/rules?${qs}&bucket=${encodeURIComponent(bucket)}`),
    budget: () => json<StorageBudgetView>(`/api/v1/admin/storage/budget?${qs}`),
    updateRules: (rules: LifecycleRuleView[]) =>
      post(`/api/v1/admin/storage/rules?${qs}`, { bucketName: bucket, rules }) as Promise<boolean>,
    updateBudget: (input: StorageBudgetView) =>
      post(`/api/v1/admin/storage/budget?${qs}`, input) as Promise<StorageBudgetView>,
    sweep: () => post(`/api/v1/admin/storage/sweep?${qs}`, {}) as Promise<Array<{ tenantId: string; percentUsed: number; severity: string; alerted: boolean }>>,
    sync: () => post(`/api/v1/admin/storage/sync?${qs}`, { bucketName: bucket }) as Promise<{ synced: boolean }>,
  };
}

/** GB with 2 decimals (dashboard cards). */
export function bytesToGB(bytes: number): number {
  return Math.round((bytes / 1024 ** 3) * 100) / 100;
}
