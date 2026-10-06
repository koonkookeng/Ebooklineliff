// SSOT Phase 000 (multi-tenant branding) + Phase 005 §6.1 (Next.js 15 auth middleware)
// Canonical: apps/frontend/middleware.ts (legacy src/frontend/middleware.ts)
// - Tenant branding (CSS vars) preserved from Phase 000: subdomain/?tenant= -> headers + cookie (<10ms).
// - Auth: __Host-next-auth.session-token cookie or Bearer header verified (HS256, WebCrypto, edge-safe,
//   no new deps); verified claims forwarded as x-user-id / x-user-role / x-tenant-id.
// - Public bypass: /_next, /api/public, /login. /api/* without token -> 401; pages -> redirect /login.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const TENANTS: Record<string, { primary: string; logo: string; font: string; brand: string }> = {
  default: { primary: '#16a34a', logo: '/logo.svg', font: 'Prompt, sans-serif', brand: 'Ebook LIFF' },
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
  res.cookies.set('tenant-theme', JSON.stringify(theme), { path: '/', maxAge: 3600 });
}

export async function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const sub = host.split('.')[0];
  const param = req.nextUrl.searchParams.get('tenant');
  const tenantHint = param ?? (TENANTS[sub] ? sub : 'default');
  const { pathname } = req.nextUrl;

  // Public routes bypass (branding only)
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/public') ||
    pathname === '/login' ||
    pathname.startsWith('/login/')
  ) {
    const res = NextResponse.next();
    applyTenantBranding(res, tenantHint);
    return res;
  }

  const token =
    req.cookies.get(SESSION_COOKIE)?.value ??
    req.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized Access' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const secret = process.env.JWT_SECRET ?? 'secret-key-144-xz-dev-only-change-me';
  const claims = await verifyHs256(token, secret);
  if (!claims?.sub) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized Access' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login?error=session_expired', req.url));
  }

  const headers = new Headers(req.headers);
  headers.set('x-user-id', claims.sub);
  if (claims.role) headers.set('x-user-role', claims.role);
  headers.set('x-tenant-id', claims.tenantId ?? tenantHint);

  const res = NextResponse.next({ request: { headers } });
  applyTenantBranding(res, claims.tenantId ?? tenantHint);
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
