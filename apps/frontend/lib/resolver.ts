// SSOT Phase 025 §6.2/Task 6 — Resolver client helpers (affiliate seam + handoff)
// Canonical: apps/frontend/lib/resolver.ts
// (legacy src/frontend/lib/resolver.ts)
// - Zero new deps. Affiliate attribution seam: server records the click stream +
//   DeepLinkLog on resolve; the client persists affiliateCode to localStorage so
//   checkout/conversion can attribute commission without re-resolving.
// - RAM guard: no SDK imports here (page lazy-loads LIFF via lib/liff/liff-sdk).
import {
  ResolveShortCodeResponseSchema,
  NATIVE_HANDOFF_TIMEOUT_MS,
  type ResolveShortCodeResponse,
} from '@repo/shared';

export const AFFILIATE_STORAGE_KEY = 'AFFILIATE_CODE';

export function persistAffiliateAttribution(code: string | null | undefined): void {
  try {
    if (code && typeof window !== 'undefined') {
      window.localStorage.setItem(AFFILIATE_STORAGE_KEY, code);
    }
  } catch {
    // storage full/blocked: attribution already recorded server-side; stay silent.
  }
}

export function readPersistedAffiliate(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(AFFILIATE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function resolveShortCode(
  code: string,
  signal?: AbortSignal,
): Promise<ResolveShortCodeResponse> {
  const res = await fetch(`/api/v1/resolver/resolve?code=${encodeURIComponent(code)}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`Resolve failed (${res.status})`);
  const data = (await res.json()) as unknown;
  const parsed = ResolveShortCodeResponseSchema.safeParse(data);
  if (!parsed.success) throw new Error('Invalid resolve response');
  persistAffiliateAttribution(parsed.data.affiliateCode);
  return parsed.data;
}

/** External-browser fallback: attempt native LINE open, else PWA after 1.5s (§1.3). */
export function openNativeLineApp(liffId: string, liffState: string): void {
  if (typeof window === 'undefined') return;
  const scheme = `line://app/${liffId}?liff.state=${encodeURIComponent(liffState)}`;
  window.location.href = scheme;
  window.setTimeout(() => {
    // Still here → LINE not installed: fall through to web PWA (caller routes).
  }, NATIVE_HANDOFF_TIMEOUT_MS);
}
