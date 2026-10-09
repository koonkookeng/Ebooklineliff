// SSOT Phase 087 BDD-1 — Stock reserve proxy (authed, rate-limited server-side)
// Canonical: apps/frontend/app/api/v1/flash-sale/reserve/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const body = await req.json().catch(() => null);
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/flash-sale/reserve`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ success: false, message: 'Flash service unavailable', remainingStock: 0 }, { status: 503 });
  }
}
