// SSOT Phase 097 — B2B client (REST transport)
// Canonical: apps/frontend/lib/b2b/b2b-client.ts
// - Zero-dep (fetch only).
export type B2bStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface LicenseInfo {
  licenseId: string;
  corporateAccountId: string;
  companyName: string;
  productId: string;
  productTitle: string;
  totalSeats: number;
  usedSeats: number;
  remainingSeats: number;
  status: string;
}

export interface ClaimResult {
  success: boolean;
  message: string;
  licenseId: string;
  assignedSeatId: string;
  entitlementGranted: boolean;
  remainingSeats: number;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`b2b ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function b2bApi() {
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    licenseInfo: (code: string) =>
      json<LicenseInfo>(`/api/v1/b2b/license-info?code=${encodeURIComponent(code)}`),
    claim: (licenseCode: string) =>
      post('/api/v1/b2b/claim', { licenseCode }) as Promise<ClaimResult>,
    dashboard: (corporateAccountId: string) =>
      json<{ licenses: Array<LicenseInfo & { assigned: number; activeUsers: number }> }>(
        `/api/v1/b2b/dashboard?corporateAccountId=${encodeURIComponent(corporateAccountId)}`,
      ),
  };
}
