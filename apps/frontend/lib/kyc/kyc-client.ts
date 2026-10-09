// SSOT Phase 085 §2 — KYC client (REST transport, no PII at rest here)
// Canonical: apps/frontend/lib/kyc/kyc-client.ts
// - Encrypted fields never touch localStorage; only status + ticket kinds.
// - Zero-dep (fetch only).
export type KycStatus =
  | 'LIFF_INIT'
  | 'IDLE'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

export interface KycStatusResponse {
  kycStatus: string;
  payoutStatus: string | null;
  rejectionReason: string | null;
}

export interface KycSubmitResponse {
  success: boolean;
  kycId: string;
  nameMatchScore: number;
  tier: 'AUTO' | 'REVIEW' | 'REJECT';
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new Error(`kyc ${res.status}`);
  return (await res.json().catch(() => null)) as T;
}

export function kycApi(slug: string) {
  const qs = `tenant=${encodeURIComponent(slug)}`;
  const post = (p: string, body: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    status: () => json<KycStatusResponse>(`/api/v1/kyc/status?${qs}`),
    submit: (body: unknown) => post(`/api/v1/kyc/submit?${qs}`, body) as Promise<KycSubmitResponse>,
    presign: (kind: 'id-card' | 'selfie' | 'bookbank') =>
      post(`/api/v1/kyc/presign?${qs}`, { kind }) as Promise<{ objectKey: string; uploadUrl: string; expiresInSec: number }>,
  };
}

export async function uploadToVault(uploadUrl: string, blob: Blob): Promise<void> {
  const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  if (!res.ok) throw new Error(`vault upload ${res.status}`);
}
