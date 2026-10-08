// SSOT Phase 052 §5.2 — analytics pulse proxy (sendBeacon + JWT cookie forward).
// Canonical: apps/frontend/app/api/v1/analytics/pulse/route.ts
// - sendBeacon posts Blob bodies; Next parses JSON (400 on malformed).
// - Identity rides the JWT cookie (server stamps userIds; Gate 4).
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ success: false, status: 'INVALID' }, { status: 400 });
  }
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/analytics/pulse`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ success: false, status: 'UNAVAILABLE' }, { status: 503 });
  }
}
