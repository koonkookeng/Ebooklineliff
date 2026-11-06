// SSOT Phase 131 §6.3 — OAuth callback (provider → backend → HttpOnly cookies)
// Canonical: apps/frontend/app/api/auth/callback/[provider]/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import {
  STATE_COOKIE,
  applySessionCookies,
  clearStateCookie,
  postToBackend,
  publicAppOrigin,
  safeNextPath,
} from '../../../../../lib/auth-cookies';

const PROVIDERS: Record<string, 'LINE_WEB' | 'GOOGLE'> = {
  line: 'LINE_WEB',
  google: 'GOOGLE',
};

function loginError(origin: string, code: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(code)}`, origin));
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const origin = publicAppOrigin(req);
  const { provider: providerKeyRaw } = await context.params;
  const providerKey = (providerKeyRaw ?? '').toLowerCase();
  const provider = PROVIDERS[providerKey];
  if (!provider) {
    const out = loginError(origin, 'unsupported_provider');
    clearStateCookie(out);
    return out;
  }

  const code = req.nextUrl.searchParams.get('code') ?? '';
  const state = req.nextUrl.searchParams.get('state') ?? '';
  const providerError = req.nextUrl.searchParams.get('error');
  if (providerError) {
    const out = loginError(origin, 'oauth_denied');
    clearStateCookie(out);
    return out;
  }
  if (!code || !state) {
    const out = loginError(origin, 'oauth_failed');
    clearStateCookie(out);
    return out;
  }
  const startedState = req.cookies.get(STATE_COOKIE)?.value;
  if (!startedState || startedState !== state) {
    const out = loginError(origin, 'oauth_failed');
    clearStateCookie(out);
    return out;
  }

  const redirectUri = `${origin}/api/auth/callback/${providerKey}`;

  try {
    const res = await postToBackend(req, '/auth/web/callback', {
      provider,
      code,
      state,
      redirectUri,
    });
    if (!res.ok) return loginError(origin, 'oauth_failed');

    const session = (await res.json()) as {
      accessToken?: unknown;
      refreshToken?: unknown;
      expiresIn?: unknown;
      next?: unknown;
    };
    if (typeof session.accessToken !== 'string' || typeof session.refreshToken !== 'string') {
      return loginError(origin, 'oauth_failed');
    }

    const destination = safeNextPath(session.next);
    const out = NextResponse.redirect(new URL(destination, origin));
    applySessionCookies(out, {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: typeof session.expiresIn === 'number' ? session.expiresIn : undefined,
    });
    clearStateCookie(out);
    return out;
  } catch {
    const out = loginError(origin, 'oauth_failed');
    clearStateCookie(out);
    return out;
  }
}
