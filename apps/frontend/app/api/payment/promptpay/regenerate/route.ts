// SSOT Phase 013 §6 — Dynamic QR regenerate proxy (expired → fresh TTL + slot)
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
    const res = await fetch(`${backend}/api/payment/promptpay/regenerate`, { method: 'POST', headers: h, body: JSON.stringify(body) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'QR service unavailable' }, { status: 503 });
  }
}
