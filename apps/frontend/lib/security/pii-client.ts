// SSOT Phase 107 §6.1 — PII edge client (unmask + policy, zero-dep, LIFF-safe)
// Canonical: apps/frontend/lib/security/pii-client.ts
// - requestUnmask posts reason-gated unmask intents via the v1 proxy (JWT cookie
//   binds identity; plaintext lives in memory only, never localStorage).
// - fetchPiiPolicy reads the effective (tenant, role) unmask policy.
// - Zero new deps.
export interface UnmaskResult {
  plainText: string;
  expiresInSec: number;
}

export async function requestUnmask(input: {
  targetUserId: string;
  fieldType: string;
  reason: string;
}): Promise<UnmaskResult | null> {
  try {
    const res = await fetch('/api/v1/pii/unmask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetEntityId: input.targetUserId,
        fieldType: input.fieldType,
        reason: input.reason,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: UnmaskResult };
    if (!json.success || !json.data) return null;
    return json.data;
  } catch {
    return null;
  }
}

export interface PiiPolicy {
  tenantId: string;
  role: string;
  canUnmask: boolean;
  maxUnmasksPerDay: number;
}

export async function fetchPiiPolicy(tenantId: string, role: string): Promise<PiiPolicy | null> {
  try {
    const res = await fetch(
      `/api/v1/pii/policy?tenantId=${encodeURIComponent(tenantId)}&role=${encodeURIComponent(role)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: PiiPolicy };
    return json.data ?? null;
  } catch {
    return null;
  }
}
