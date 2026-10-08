// SSOT Phase 056 §3.2 — Viewport config proxy (JWT passthrough)
// Canonical: apps/frontend/app/api/v1/viewport/config/route.ts
// - Forwards { productId, capabilities } to the NestJS viewport gateway
//   (POST /api/v1/viewport/config). Non-OK statuses pass through so the
//   router enters ERROR_FALLBACK with retry + Web direct link.
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  const userId = req.headers.get('x-user-id');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  if (userId) h['x-user-id'] = userId;
  try {
    const body = await req.json().catch(() => null);
    if (!body?.productId || !body?.capabilities) {
      return NextResponse.json({ message: 'Missing viewport config identity' }, { status: 400 });
    }
    const res = await fetch(`${backend}/api/v1/viewport/config`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Viewport service unavailable' }, { status: 503 });
  }
}
