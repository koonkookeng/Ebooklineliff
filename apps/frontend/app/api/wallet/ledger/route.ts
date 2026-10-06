// SSOT Phase 017 §6 — Wallet ledger proxy
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const take = new URL(req.url).searchParams.get('take') ?? '20';
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = req.headers.get('authorization');
    const cookie = req.headers.get('cookie');
    if (auth) h['authorization'] = auth;
    if (cookie) h['cookie'] = cookie;
    const res = await fetch(`${backend}/api/wallet/ledger?take=${encodeURIComponent(take)}`, { headers: h });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Wallet service unavailable' }, { status: 503 });
  }
}
