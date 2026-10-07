// SSOT Phase 042 BDD-2 — Violation report proxy (see seed/route.ts header).
// Canonical: apps/frontend/app/api/v1/watermark/violation/route.ts
// - POST {violationType, metadata} → NestJS violation sink (async audit log).
// - Always 200-to-caller shaped (reporting must never break the lock UX).
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ message: 'Invalid violation report' }, { status: 400 });
    const res = await fetch(`${backend}/api/v1/watermark/violation`, { method: 'POST', headers: h, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Watermark service unavailable' }, { status: 503 });
  }
}
