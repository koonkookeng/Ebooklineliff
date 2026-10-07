// SSOT Phase 041 — bookmark toggle proxy (see annotations/route.ts header).
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
    if (!body || typeof body !== 'object') return NextResponse.json({ message: 'Invalid bookmark input' }, { status: 400 });
    const res = await fetch(`${backend}/api/v1/reader-control/bookmark`, { method: 'POST', headers: h, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Reader service unavailable' }, { status: 503 });
  }
}
