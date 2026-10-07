// SSOT Phase 029 Task 5 — Predictive prefetch proxy (auth passthrough)
// Canonical: apps/frontend/app/api/v1/performance/prefetch/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/performance/prefetch`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Performance service unavailable' }, { status: 503 });
  }
}
