// SSOT Phase 028 §6.1 — Edge-safe CSP header builder (Next.js middleware)
// Canonical: apps/frontend/lib/security/csp-header.ts
// - BYTE-PARITY with buildCspHeader() in @repo/shared (security-csp.schema.ts):
//   same options, same template, same join — enforced by
//   scripts/test-phase028-contracts.ts (exact string equality).
// - Lives here (not imported from @repo/shared) so the Edge runtime bundle stays
//   zod-free (Gate 5/6); any directive change MUST land in both files + the parity test.
// - Nonce: minted per request in middleware.ts via crypto.randomUUID (edge-safe).

export interface EdgeCspOptions {
  nonce?: string;
  isDev?: boolean;
}

export function mintEdgeNonce(): string {
  try {
    return btoa(String.fromCharCode(...new TextEncoder().encode(crypto.randomUUID()))).replace(/=+$/, '');
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export function buildEdgeCspHeader(options: EdgeCspOptions = {}): string {
  const { nonce = '', isDev = false } = options;
  const scriptSrc = [
    "'self'",
    ...(nonce ? [`'nonce-${nonce}'`] : []),
    "'strict-dynamic'",
    'https://static.line-scdn.net',
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(' ');
  return [
    "default-src 'self' https://api.omnichannel.com",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'img-src \'self\' data: blob: https://cdn.omnichannel.com https://profile.line-scdn.net https://*.line-scdn.net https://*.cloudflarestorage.com',
    'font-src \'self\' data: https://fonts.gstatic.com',
    'media-src \'self\' blob: https://videocdn.omnichannel.com https://*.cloudflarestorage.com',
    'connect-src \'self\' https://api.omnichannel.com https://videocdn.omnichannel.com https://cdn.omnichannel.com https://access.line.me https://api.line.me wss://api.omnichannel.com https://*.easyslip.com',
    'frame-src \'self\' https://access.line.me https://liff.line.me',
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self' https://liff.line.me https://*.line.me",
    'report-uri /api/security/csp-report',
    'upgrade-insecure-requests',
  ].join('; ');
}

/** Security response headers applied to every edge response (CSP + hardening). */
export function edgeSecurityHeaders(nonce: string, isDev: boolean): Record<string, string> {
  return {
    'Content-Security-Policy': buildEdgeCspHeader({ nonce, isDev }),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-CSP-Nonce': nonce,
  };
}
