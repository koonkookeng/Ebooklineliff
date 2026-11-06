// SSOT Phase 131 §6.4 — Email magic-link request (no account enumeration)
// Canonical: apps/frontend/app/api/auth/email/start/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { postToBackend, publicAppOrigin, safeNextPath } from '../../../../../lib/auth-cookies';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = publicAppOrigin(req);
  let body: { email?: unknown; tenant?: unknown; next?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }
  const tenant =
    (typeof body.tenant === 'string' && body.tenant.trim()) ||
    req.headers.get('x-tenant-identifier') ||
    'default';

  try {
    const res = await postToBackend(req, '/auth/email/start', {
      email,
      tenant,
      appUrl: origin,
      next: safeNextPath(body.next),
    });
    if (res.status === 429) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: 'email_unavailable' }, { status: 503 });
    }
    // The backend intentionally returns the same shape for known/unknown inboxes.
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'email_unavailable' }, { status: 503 });
  }
}
