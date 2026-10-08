// SSOT Phase 070 Task 4 — handshake proxies (JWT passthrough).
// Canonical: apps/frontend/app/api/v1/sync/handshake/[issue|authorize]/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request): Promise<NextResponse> {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tail = new URL(req.url).pathname.split('/api/v1/sync/handshake/')[1] ?? 'issue';
  const body = await req.json().catch(() => null);
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/sync/handshake/${tail}`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Handshake service unavailable' }, { status: 503 });
  }
}
