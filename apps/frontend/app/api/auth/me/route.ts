// SSOT Phase 131 §6.6 — Current session profile (BFF)
// Canonical: apps/frontend/app/api/auth/me/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, getFromBackend } from '../../../../lib/auth-cookies';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const res = await getFromBackend(req, '/auth/web/me', token);
    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json({ error: 'upstream_unavailable' }, { status: 502 });
  }
}
