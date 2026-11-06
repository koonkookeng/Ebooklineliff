// SSOT Phase 131 §6.7 — Logout (revoke server session + clear BFF cookies)
// Canonical: apps/frontend/app/api/auth/logout/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  backendBaseUrl,
  clearSessionCookies,
} from '../../../../lib/auth-cookies';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    await fetch(`${backendBaseUrl()}/api/v1/auth/web/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    }).catch(() => undefined);
  }
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res);
  return res;
}
