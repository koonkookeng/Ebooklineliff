// SSOT Phase 000 (multi-tenant branding) + Phase 005 §6.1 (Next.js 15 auth middleware) + Phase 021 (dynamic tenant LIFF ID)
// Canonical: apps/frontend/middleware.ts (legacy src/frontend/middleware.ts)
// - Tenant branding (CSS vars) preserved from Phase 000: subdomain/?tenant= -> headers + cookie (<10ms).
// - Auth: __Host-next-auth.session-token cookie or Bearer header verified (HS256, WebCrypto, edge-safe,
//   no new deps); verified claims forwarded as x-user-id / x-user-role / x-tenant-id.
// - Public bypass: /_next, /api/public, /login. /api/* without token -> 401; pages -> redirect /login.
// - Phase 021: Dynamic LIFF ID per tenant (x-liff-id header for LIFF SDK init)
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { buildEdgeCspHeader, mintEdgeNonce } from './lib/security/csp-header';

const TENANTS: Record<string, { primary: string; logo: string; font: string; brand: string; liffId: string }> = {
  default: { primary: '#16a34a', logo: '/logo.svg', font: 'Prompt, sans-serif', brand: 'Ebook LIFF', liffId: process.env.NEXT_PUBLIC_DEFAULT_LIFF_ID ?? 'default-liff-id' },
};

const SESSION_COOKIE = '__Host-next-auth.session-token';

function b64urlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes as Uint8Array<ArrayBuffer>;
}

interface JwtClaims {
  sub?: string;
  role?: string;
  tenantId?: string;
  exp?: number;
}

async function verifyHs256(token: string, secret: string): Promise<JwtClaims | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlToBytes(sig),
      new TextEncoder().encode(`${header}.${body}`),
    );
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))) as JwtClaims;
    if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null;
    if (!claims.sub) return null;
    return claims;
  } catch {
    return null;
  }
}

function applyTenantBranding(res: NextResponse, tenant: string): void {
  const theme = TENANTS[tenant] ?? TENANTS.default;
  res.headers.set('x-tenant', tenant);
  res.headers.set('x-primary-color', theme.primary);
  res.headers.set('x-brand-name', theme.brand);
  res.headers.set('x-liff-id', theme.liffId);
  res.cookies.set('tenant-theme', JSON.stringify(theme), { path: '/', maxAge: 3600 });
}

// SSOT Phase 028 §6.1 — strict CSP on every edge response (first millisecond,
// before HTML render). Directives byte-mirror buildCspHeader() (@repo/shared);
// parity enforced by scripts/test-phase028-contracts.ts.
function applyCsp(res: NextResponse, nonce: string, isDev: boolean): NextResponse {
  res.headers.set('Content-Security-Policy', buildEdgeCspHeader({ nonce, isDev }));
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('X-CSP-Nonce', nonce);
  return res;
}

export async function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const sub = host.split('.')[0];
  const param = req.nextUrl.searchParams.get('tenant');
  const tenantHint = param ?? (TENANTS[sub] ? sub : 'default');
  const { pathname } = req.nextUrl;
  // Phase 028 §6.1: per-request nonce + strict CSP (dev keeps unsafe-eval for HMR).
  const nonce = mintEdgeNonce();
  const isDev = process.env.NODE_ENV === 'development';

  // Phase 025 §6.1: permanent mini-app scheme resolver (public link entry).
  // /r/:shortCode and /resolve bypass auth (resolution itself is public; the
  // entitlement gatekeeper + requiresAuth enforce access after dispatch).
  // Non-LINE mobile browsers get a native LINE handoff (line://app/<liffId>);
  // LINE in-app + desktop fall through to the LIFF resolver route with tenant.
  if (pathname.startsWith('/r/') || pathname === '/resolve' || pathname.startsWith('/resolve/')) {
    const res = NextResponse.next();
    applyTenantBranding(res, tenantHint);
    if (pathname.startsWith('/r/')) {
      const shortCode = pathname.split('/')[2] ?? '';
      const ua = req.headers.get('user-agent') ?? '';
      const isLineApp = /Line/i.test(ua);
      const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
      if (!isLineApp && isMobile && shortCode) {
        const theme = TENANTS[tenantHint] ?? TENANTS.default;
        const nativeScheme = `line://app/${theme.liffId}?liff.state=${encodeURIComponent(`/resolve?code=${shortCode}`)}`;
        // Explicit 302 (not NextResponse.redirect): custom `line://` schemes
        // bypass framework URL validation; mobile OS honors Location directly.
        const redirect = new NextResponse(null, {
          status: 302,
          headers: { Location: nativeScheme, 'Cache-Control': 'no-store' },
        });
        applyTenantBranding(redirect, tenantHint);
        return applyCsp(redirect, nonce, isDev);
      }
      const rewriteUrl = req.nextUrl.clone();
      rewriteUrl.pathname = '/resolve';
      if (shortCode) rewriteUrl.searchParams.set('code', shortCode);
      rewriteUrl.searchParams.set('tenant', tenantHint);
      const rewritten = NextResponse.rewrite(rewriteUrl);
      applyTenantBranding(rewritten, tenantHint);
      return applyCsp(rewritten, nonce, isDev);
    }
    return applyCsp(res, nonce, isDev);
  }

  // Public routes bypass (branding only) — Phase 010: storefront home, PDP and
  // catalog discovery stay public (BDD: user opens LIFF storefront unauthenticated).
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/public') ||
    pathname.startsWith('/api/v1/resolver/') ||
    // Phase 026: viral preview is public (recipients may be logged out).
    pathname === '/api/v1/social-share/preview' ||
    // Phase 028: CSP violation beacons carry no auth (sendBeacon from any page).
    pathname === '/api/security/csp-report' ||
    pathname.startsWith('/api/search') ||
    pathname.startsWith('/api/storefront') ||
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname === '/' ||
    pathname.startsWith('/pdp/') ||
    pathname.startsWith('/catalog')
  ) {
    const res = NextResponse.next();
    applyTenantBranding(res, tenantHint);
    return applyCsp(res, nonce, isDev);
  }

  const token =
    req.cookies.get(SESSION_COOKIE)?.value ??
    req.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return applyCsp(NextResponse.json({ error: 'Unauthorized Access' }, { status: 401 }), nonce, isDev);
    }
    return applyCsp(NextResponse.redirect(new URL('/login', req.url)), nonce, isDev);
  }

  const secret = process.env.JWT_SECRET ?? 'secret-key-144-xz-dev-only-change-me';
  const claims = await verifyHs256(token, secret);
  if (!claims?.sub) {
    if (pathname.startsWith('/api/')) {
      return applyCsp(NextResponse.json({ error: 'Unauthorized Access' }, { status: 401 }), nonce, isDev);
    }
    return applyCsp(NextResponse.redirect(new URL('/login?error=session_expired', req.url)), nonce, isDev);
  }

  const headers = new Headers(req.headers);
  headers.set('x-user-id', claims.sub);
  if (claims.role) headers.set('x-user-role', claims.role);
  headers.set('x-tenant-id', claims.tenantId ?? tenantHint);
  headers.set('x-csp-nonce', nonce);

  const res = NextResponse.next({ request: { headers } });
  applyTenantBranding(res, claims.tenantId ?? tenantHint);
  return applyCsp(res, nonce, isDev);
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
