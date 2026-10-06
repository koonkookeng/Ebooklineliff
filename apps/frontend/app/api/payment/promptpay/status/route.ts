// SSOT Phase 013 §6 — QR status proxy (lazy expiry read)
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  const orderId = new URL(req.url).searchParams.get('orderId') ?? '';
  try {
    const res = await fetch(`${backend}/api/payment/promptpay/status?orderId=${encodeURIComponent(orderId)}`, { headers: h });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'QR service unavailable' }, { status: 503 });
  }
}
