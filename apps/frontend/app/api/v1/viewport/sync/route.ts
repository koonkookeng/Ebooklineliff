// SSOT Phase 056 §3.2 — Viewport state-sync proxy (JWT passthrough, <200ms)
// Canonical: apps/frontend/app/api/v1/viewport/sync/route.ts
// - Forwards the ViewportStateSyncInput to the NestJS gateway
//   (POST /api/v1/viewport/sync). Zod-gated on the backend; 4xx passes
//   through so clients can drop the beacon without retry storms.
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
    if (!body?.productId || !body?.viewportMode) {
      return NextResponse.json({ message: 'Missing viewport sync identity' }, { status: 400 });
    }
    const res = await fetch(`${backend}/api/v1/viewport/sync`, {
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
