// SSOT Phase 105 §3.1/§6 — Public verification client (no auth, public page)
// Canonical: apps/frontend/lib/certificate/certificate-verify-client.ts
// - Recruiter-facing: no JWT, tenant via query. Zero-dep (fetch only).
import type { CertificateVerificationPayload } from '@repo/shared';

export type VerifyStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export async function fetchPublicVerification(
  certificateNo: string,
  hash?: string,
): Promise<CertificateVerificationPayload> {
  const q = hash ? `?hash=${encodeURIComponent(hash)}` : '';
  const res = await fetch(`/api/v1/certificates/public/verify/${encodeURIComponent(certificateNo)}${q}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    // 404/429 still carry the §3.1 payload body when the backend is reachable.
    const body = await res.json().catch(() => null);
    if (body && typeof body.status === 'string') return body as CertificateVerificationPayload;
    throw new Error(`verify ${res.status}`);
  }
  return (await res.json()) as CertificateVerificationPayload;
}
