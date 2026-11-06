// SSOT Phase 131 §6.5 — Email magic-link verification (single-use)
// Canonical: apps/frontend/app/api/auth/email/verify/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import {
  applySessionCookies,
  postToBackend,
  publicAppOrigin,
  safeNextPath,
} from '../../../../../lib/auth-cookies';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = publicAppOrigin(req);
  const token = req.nextUrl.searchParams.get('token') ?? '';
  if (!token) {
    return NextResponse.redirect(new URL('/login?error=magic_link_invalid', origin));
  }
  try {
    const res = await postToBackend(req, '/auth/email/verify', { token });
    if (!res.ok) {
      return NextResponse.redirect(new URL('/login?error=magic_link_invalid', origin));
    }
    const session = (await res.json()) as {
      accessToken?: unknown;
      refreshToken?: unknown;
      expiresIn?: unknown;
      next?: unknown;
    };
    if (typeof session.accessToken !== 'string' || typeof session.refreshToken !== 'string') {
      return NextResponse.redirect(new URL('/login?error=magic_link_invalid', origin));
    }
    const destination = safeNextPath(session.next);
    const out = NextResponse.redirect(new URL(destination, origin));
    applySessionCookies(out, {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: typeof session.expiresIn === 'number' ? session.expiresIn : undefined,
    });
    return out;
  } catch {
    return NextResponse.redirect(new URL('/login?error=magic_link_invalid', origin));
  }
}
