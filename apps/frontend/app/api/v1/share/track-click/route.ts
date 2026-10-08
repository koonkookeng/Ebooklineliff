// SSOT Phase 080 BDD-2 — Click-attribution proxy (public: recipients may be anonymous)
// Canonical: apps/frontend/app/api/v1/share/track-click/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const body = await req.json().catch(() => null);
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  const ua = req.headers.get('user-agent');
  const fwd = req.headers.get('x-forwarded-for');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  if (ua) h['user-agent'] = ua;
  if (fwd) h['x-forwarded-for'] = fwd;
  try {
    const res = await fetch(`${backend}/api/v1/share/track-click`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ success: false, affiliateCode: '', isNewSession: false }, { status: 503 });
  }
}
