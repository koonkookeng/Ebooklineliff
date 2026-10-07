// SSOT Phase 040 Task 40.2 — Reading-progress sync proxy (JWT passthrough)
// Canonical: apps/frontend/app/api/v1/reader/progress/route.ts
// - POST {productId,lastPage,readDurationSec} → NestJS single-upsert (<50ms).
// - Offline callers queue via lib/reader/offline-chunk-cache and replay here.
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ message: 'Invalid progress payload' }, { status: 400 });
    }
    const res = await fetch(`${backend}/api/v1/reader/progress`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Reader service unavailable' }, { status: 503 });
  }
}
