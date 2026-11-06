// SSOT Phase 131 §6.2 — OAuth start (same-origin entry point)
// Canonical: apps/frontend/app/api/auth/start/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import {
  applyStateCookie,
  postToBackend,
  publicAppOrigin,
  safeNextPath,
} from '../../../../lib/auth-cookies';

const PROVIDERS: Record<string, 'LINE_WEB' | 'GOOGLE'> = {
  line: 'LINE_WEB',
  google: 'GOOGLE',
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = publicAppOrigin(req);
  const providerKey = (req.nextUrl.searchParams.get('provider') ?? '').toLowerCase();
  const provider = PROVIDERS[providerKey];
  if (!provider) {
    return NextResponse.redirect(new URL('/login?error=unsupported_provider', origin));
  }
  const tenant =
    req.nextUrl.searchParams.get('tenant') ??
    req.headers.get('x-tenant-identifier') ??
    'default';
  const next = safeNextPath(req.nextUrl.searchParams.get('next'));
  const redirectUri = `${origin}/api/auth/callback/${providerKey}`;

  try {
    const res = await postToBackend(req, '/auth/web/start', {
      provider,
      tenant,
      redirectUri,
      next,
    });
    if (!res.ok) {
      return NextResponse.redirect(new URL('/login?error=oauth_unavailable', origin));
    }
    const data = (await res.json()) as { authorizeUrl?: unknown; state?: unknown };
    if (typeof data.authorizeUrl !== 'string' || typeof data.state !== 'string') {
      return NextResponse.redirect(new URL('/login?error=oauth_unavailable', origin));
    }
    const authorizeUrl = new URL(data.authorizeUrl);
    if (authorizeUrl.protocol !== 'https:') {
      return NextResponse.redirect(new URL('/login?error=oauth_unavailable', origin));
    }
    const out = NextResponse.redirect(authorizeUrl);
    applyStateCookie(out, data.state);
    return out;
  } catch {
    return NextResponse.redirect(new URL('/login?error=oauth_unavailable', origin));
  }
}
