// SSOT Phase 089 BDD-2 — Gift claim + detail proxies (code is the auth)
// Canonical: apps/frontend/app/api/v1/gifts/claim/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const body = await req.json().catch(() => null);
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/gifts/claim`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ success: false, message: 'Gift service unavailable', productId: null }, { status: 503 });
  }
}
