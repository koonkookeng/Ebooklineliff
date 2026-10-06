// SSOT Phase 014 §5.4 — v1 slip verification proxy (spec route, auth passthrough)
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const body = await req.json();
    const res = await fetch(`${backend}/api/v1/payment/verify-slip`, { method: 'POST', headers: h, body: JSON.stringify(body) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Verification service unavailable' }, { status: 503 });
  }
}
