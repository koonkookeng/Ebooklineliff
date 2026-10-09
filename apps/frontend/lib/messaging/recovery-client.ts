// SSOT Phase 084 §2.1 — Recovery client (REST transport + countdown)
// Canonical: apps/frontend/lib/messaging/recovery-client.ts
// - Magic-link recovery + analytics over proxied REST (auth passthrough).
// - Zero-dep (fetch only).
export type RecoveryStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface RecoveryItem {
  productId: string;
  title: string;
  coverImageUrl: string;
  price: number;
  quantity: number;
}

export interface RecoverySession {
  cartId: string;
  userId: string;
  status: string;
  items: RecoveryItem[];
  totalAmount: number;
  discountAmount: number | null;
  recoveryCouponCode: string | null;
  expiresAt: string | null;
}

export interface RecoveryPayload {
  success: boolean;
  message: string;
  cartSession: RecoverySession | null;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`recovery ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function recoveryApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  return {
    recover: (recoveryToken: string) =>
      json<RecoveryPayload>(`/api/v1/abandoned-cart/recover?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryToken }),
      }),
    analytics: () =>
      json<{
        totalAbandonedCount: number;
        recoveredCount: number;
        recoveredRevenue: number;
        recoveryRatePercentage: number;
      }>(`/api/v1/abandoned-cart/analytics?${qs}`),
  };
}

/** Live countdown parts from an expiry ISO string (clamped at 0). */
export function countdownParts(expiresAt: string | null, now = Date.now()): { mm: number; ss: number; live: boolean } {
  if (!expiresAt) return { mm: 0, ss: 0, live: false };
  const left = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
  return { mm: Math.floor(left / 60), ss: left % 60, live: left > 0 };
}
