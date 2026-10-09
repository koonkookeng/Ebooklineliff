// SSOT Phase 107 — PII unmask proxy (reason-gated, JWT cookie binds identity)
// Canonical: apps/frontend/app/api/v1/pii/unmask/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request): Promise<NextResponse> {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const body = await req.json().catch(() => ({}));
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const auth = req.headers.get('authorization');
    const cookie = req.headers.get('cookie');
    if (auth) headers['authorization'] = auth;
    if (cookie) headers['cookie'] = cookie;
    const res = await fetch(`${backend}/api/v1/pii/unmask`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'PII service unavailable' }, { status: 503 });
  }
}
