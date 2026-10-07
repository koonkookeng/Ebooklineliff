// SSOT Phase 033 Task 2 — Version check proxy (public, no-cache passthrough)
// Canonical: apps/frontend/app/api/v1/version/check/route.ts
// (§8.1: the browser request is no-cache; the backend owns the 300s edge TTL.)
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    const res = await fetch(`${backend}/api/v1/version/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    const out = NextResponse.json(data, { status: res.status });
    out.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    return out;
  } catch {
    return NextResponse.json({ message: 'Version service unavailable' }, { status: 503 });
  }
}
