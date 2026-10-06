// SSOT Phase 018 §8 — Library gatekeeper proxy (pre-reader entitlement check)
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const productId = new URL(req.url).searchParams.get('productId') ?? '';
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = req.headers.get('authorization');
    const cookie = req.headers.get('cookie');
    if (auth) h['authorization'] = auth;
    if (cookie) h['cookie'] = cookie;
    const res = await fetch(`${backend}/api/library/gate?productId=${encodeURIComponent(productId)}`, { headers: h });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Library service unavailable' }, { status: 503 });
  }
}
