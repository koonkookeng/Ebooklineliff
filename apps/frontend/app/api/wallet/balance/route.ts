// SSOT Phase 017 §6 — Wallet balance proxy (tenant passthrough, zero-egress)
import { NextResponse } from 'next/server';

function headersOf(req: Request): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${backend}/api/wallet/balance`, { headers: headersOf(req) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Wallet service unavailable' }, { status: 503 });
  }
}
