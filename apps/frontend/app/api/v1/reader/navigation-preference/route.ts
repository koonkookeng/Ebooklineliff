// SSOT Phase 059 §5.1 — navigation-preference proxy (JWT passthrough).
// Canonical: apps/frontend/app/api/v1/reader/navigation-preference/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/reader/navigation-preference`, { headers: h, cache: 'no-store' });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Reader service unavailable' }, { status: 503 });
  }
}
