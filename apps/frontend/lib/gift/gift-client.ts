// SSOT Phase 089 — Gift client (REST transport)
// Canonical: apps/frontend/lib/gift/gift-client.ts
// - Zero-dep (fetch only).
export type GiftStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface GiftDetail {
  giftId: string;
  claimCode: string;
  status: string;
  productTitle: string;
  productCoverUrl: string;
  productType: string;
  senderName: string;
  greetingTheme: string;
  greetingMessage: string;
  expiresAt: string;
  claimedAt: string | null;
  recipientName: string | null;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`gift ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function giftApi() {
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    detail: (code: string) => json<GiftDetail>(`/api/v1/gifts/detail?code=${encodeURIComponent(code)}`),
    claim: (claimCode: string) =>
      post('/api/v1/gifts/claim', { claimCode }) as Promise<{ success: boolean; message: string; productId: string | null }>,
    mine: (slug: string) =>
      json<Array<{ id: string; claimCode: string; status: string }>>(`/api/v1/gifts/mine?tenant=${encodeURIComponent(slug)}`),
  };
}
