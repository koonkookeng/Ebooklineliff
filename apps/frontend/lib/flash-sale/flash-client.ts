// SSOT Phase 087 §2 — Flash sale client (REST transport)
// Canonical: apps/frontend/lib/flash-sale/flash-client.ts
// - Zero-dep (fetch only).
export type FlashStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface FlashCampaign {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  status: string;
  serverCurrentTime: string;
  items: Array<{
    productId: string;
    productTitle: string;
    coverImageUrl: string;
    originalPrice: number;
    flashSalePrice: number;
    allocatedStock: number;
    soldQty: number;
    remainingStock: number;
    maxPerUser: number;
    discountPercentage: number;
  }>;
}

export interface ReserveResult {
  success: boolean;
  reservationToken: string | null;
  expiresAt: string | null;
  message: string;
  remainingStock: number;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`flash-sale ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function flashApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  return {
    campaign: () => json<FlashCampaign | null>(`/api/v1/flash-sale/campaign?${qs}`),
    reserve: (campaignId: string, productId: string, quantity = 1) =>
      json<ReserveResult>(`/api/v1/flash-sale/reserve?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, productId, quantity }),
      }),
  };
}
