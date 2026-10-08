// SSOT Phase 077 §6 — Logistics client (REST transport)
// Canonical: apps/frontend/lib/logistics/logistics-client.ts
// - Proxied REST (auth passthrough); dep-free tracking stepper data shape.
// - Zero-dep (fetch only).
export type TrackingStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface TrackingHistoryRow {
  statusCode: string;
  statusText: string;
  location: string | null;
  eventTimestamp: string;
}

export interface ShipmentTracking {
  orderNumber: string;
  carrier: string;
  trackingNumber: string;
  status: string;
  history: TrackingHistoryRow[];
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`logistics ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function logisticsApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  return {
    book: (body: unknown) =>
      json<{ shipmentId: string; trackingNumber: string; labelUrl: string | null }>(
        `/api/v1/logistics/parcels/book?${qs}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      ),
    tracking: (orderId: string) =>
      json<ShipmentTracking>(`/api/v1/logistics/shipments/${encodeURIComponent(orderId)}?${qs}`),
  };
}
