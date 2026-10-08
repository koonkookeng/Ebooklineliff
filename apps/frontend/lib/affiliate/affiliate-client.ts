// SSOT Phase 079 §6 — Affiliate client (REST transport + offline code)
// Canonical: apps/frontend/lib/affiliate/affiliate-client.ts
// - Proxied REST (auth passthrough); affiliateCode cached in IndexedDB so
//   links/QR render offline (§2.1 OFFLINE_FIRST).
// - Zero-dep (fetch only).
export type AffiliateStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface AffiliateDashboard {
  totalEarnings: number;
  pendingEarnings: number;
  tier1ReferralsCount: number;
  tier2ReferralsCount: number;
  affiliateCode: string;
  referralLink: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`affiliate ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function affiliateApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    dashboard: () => json<AffiliateDashboard>(`/api/v1/affiliate/dashboard?${qs}`),
    referralLink: (body: unknown) =>
      post(`/api/v1/affiliate/referral-link?${qs}`, body) as Promise<{ signedUrl: string; qrCodeUrl: string; affiliateCode: string }>,
    flexShare: (body: unknown) =>
      post(`/api/v1/affiliate/flex-share?${qs}`, body) as Promise<{ flexMessageJson: string; shareUrl: string; trackingCode: string }>,
    payout: (body: unknown) =>
      post(`/api/v1/affiliate/payout?${qs}`, body) as Promise<{
        payoutId: string; requestedAmount: number; taxWithheld3Percent: number; netPayoutAmount: number; status: string;
      }>,
  };
}

const CODE_KEY = 'affiliate:code';

/** Cache the affiliate code locally (offline link building). */
export function cacheAffiliateCode(code: string): void {
  try {
    localStorage.setItem(CODE_KEY, code);
  } catch {
    // Best-effort cache.
  }
}

/** Read the cached affiliate code (null when absent). */
export function cachedAffiliateCode(): string | null {
  try {
    return localStorage.getItem(CODE_KEY);
  } catch {
    return null;
  }
}
