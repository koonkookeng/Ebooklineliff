// SSOT Phase 117 §2 — campaign client (REST + IDB claimed cache)
// Canonical: apps/frontend/lib/campaign/campaign-client.ts
// - Eligible coupons + my-claims cached in IndexedDB (OFFLINE_FIRST §2.1,
//   My Coupons readable offline). Mutations always online.
// - Zero-dep (fetch + IndexedDB only).
export type CampaignUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface CampaignCouponView {
  id: string;
  code: string;
  couponType: string;
  scope: string;
  discountValue: number;
  maxDiscountAmount: number | null;
  minPurchaseAmount: number;
  endDate: string | null;
  isActive: boolean;
}

export interface CampaignView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  bannerImageUrl: string | null;
  coupons: CampaignCouponView[];
}

export interface CouponValidateView {
  isValid: boolean;
  message: string;
  totalDiscountAmount: number;
  netAmount: number;
  breakdown: Array<{
    couponCode: string;
    couponType: string;
    platformDiscount: number;
    sellerDiscount: number;
    shippingDiscount: number;
    appliedItemIds: string[];
  }>;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`campaign ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

const DB_NAME = 'zene-campaign';
const STORE = 'coupon-cache';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Offline cache is best-effort — never breaks the UI.
  }
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await idb();
    const out = await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(key);
      rq.onsuccess = () => resolve((rq.result as T | undefined) ?? null);
      rq.onerror = () => resolve(null);
    });
    db.close();
    return out;
  } catch {
    return null;
  }
}

export function campaignApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    active: async () => {
      try {
        const live = await json<CampaignView[]>(`/api/v1/campaigns/active?${qs}`);
        void idbPut('campaigns:active', live);
        return live;
      } catch (err) {
        const cached = await idbGet<CampaignView[]>('campaigns:active');
        if (cached) return cached;
        throw err;
      }
    },
    validate: (body: { couponCode: string; cartItems: Array<{ productId: string; sellerId: string; productType: string; price: number; quantity: number }>; shippingFee: number }) =>
      post(`/api/v1/campaigns/validate?${qs}`, body) as Promise<CouponValidateView>,
    claim: (couponCode: string) => post(`/api/v1/campaigns/claim?${qs}`, { couponCode }) as Promise<{ claimId: string; couponCode: string }>,
    stack: (body: { codes: string[]; cartItems: Array<{ productId: string; sellerId: string; productType: string; price: number; quantity: number }>; shippingFee: number }) =>
      post(`/api/v1/campaigns/stack?${qs}`, body) as Promise<CouponValidateView>,
  };
}
