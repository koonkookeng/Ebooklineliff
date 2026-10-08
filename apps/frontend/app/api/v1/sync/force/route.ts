// SSOT Phase 057 §3.2 — Force-sync fallback proxy (REST when SSE is down)
// Canonical: apps/frontend/app/api/v1/sync/force/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const body = await req.json().catch(() => null);
    if (!body?.productId || !body?.contentType) {
      return NextResponse.json({ message: 'Missing force-sync identity' }, { status: 400 });
    }
    const res = await fetch(`${backend}/api/v1/sync/force`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Sync service unavailable' }, { status: 503 });
  }
}
