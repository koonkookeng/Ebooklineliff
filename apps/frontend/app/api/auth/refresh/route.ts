// SSOT Phase 131 §6.8 — Refresh rotation (single-use refresh token)
// Canonical: apps/frontend/app/api/auth/refresh/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import {
  REFRESH_COOKIE,
  applySessionCookies,
  clearSessionCookies,
  postToBackend,
} from '../../../../lib/auth-cookies';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const res = await postToBackend(req, '/auth/web/refresh', { refreshToken });
    if (!res.ok) {
      const out = NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      clearSessionCookies(out);
      return out;
    }
    const session = (await res.json()) as {
      accessToken?: unknown;
      refreshToken?: unknown;
      expiresIn?: unknown;
    };
    if (typeof session.accessToken !== 'string' || typeof session.refreshToken !== 'string') {
      const out = NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      clearSessionCookies(out);
      return out;
    }
    const out = NextResponse.json({ ok: true });
    applySessionCookies(out, {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: typeof session.expiresIn === 'number' ? session.expiresIn : undefined,
    });
    return out;
  } catch {
    return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 });
  }
}
