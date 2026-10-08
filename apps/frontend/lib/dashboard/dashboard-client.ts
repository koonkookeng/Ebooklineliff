// SSOT Phase 073 §6 — Merchant dashboard client (REST transport)
// Canonical: apps/frontend/lib/dashboard/dashboard-client.ts
// - Proxied REST (Next rewrites to NestJS; auth cookie passthrough).
// - Status vocabulary mirrors §2.2 (DASHBOARD_INIT..ERROR) for the shell.
// - Zero-dep (fetch only).
export type DashboardStatus = 'DASHBOARD_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface AnalyticsRow {
  recordDate: string;
  totalGmv: string;
  totalOrders: number;
  ebookSalesCount: number;
  courseSalesCount: number;
  physicalSalesCount: number;
  newStudentsCount: number;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`dashboard ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function merchantApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  return {
    analytics: (from: string, to: string) =>
      json<{ tenantId: string; rows: AnalyticsRow[] }>(
        `/api/v1/merchant/analytics?${qs}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    upsertProduct: (body: unknown) =>
      json<{ id: string; slug: string; updated: boolean }>(`/api/v1/merchant/studio/product/upsert?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    presignedUpload: (body: { fileName: string; fileSize: number; contentType: string }) =>
      json<{ uploadUrl: string; objectKey: string; expiresInSeconds: number }>(
        `/api/v1/merchant/studio/video/presigned-upload?${qs}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      ),
    payout: (body: unknown) =>
      json<{ payoutId: string; netAmount: number; payoutStatus: string }>(`/api/v1/merchant/payout/request?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    fulfillment: (body: unknown) =>
      json<{ fulfillmentId: string; status: string }>(`/api/v1/merchant/fulfillment/label?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}

/** Direct-to-R2 PUT with progress (server never sees the bytes, §8.1). */
export function putToR2(
  uploadUrl: string,
  file: File,
  onProgress: (pct: number, mbps: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const t0 = Date.now();
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const secs = Math.max(0.1, (Date.now() - t0) / 1000);
      onProgress(Math.round((e.loaded / e.total) * 100), (e.loaded / 1048576 / secs));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`r2 ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('r2 network'));
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.send(file);
  });
}
