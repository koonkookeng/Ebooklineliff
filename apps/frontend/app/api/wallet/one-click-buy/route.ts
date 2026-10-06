// SSOT Phase 017 §6 — One-click buy proxy (double-click guarded client-side)
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const body = await req.json();
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = req.headers.get('authorization');
    const cookie = req.headers.get('cookie');
    if (auth) h['authorization'] = auth;
    if (cookie) h['cookie'] = cookie;
    const res = await fetch(`${backend}/api/wallet/one-click-buy`, { method: 'POST', headers: h, body: JSON.stringify(body) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Wallet service unavailable' }, { status: 503 });
  }
}
