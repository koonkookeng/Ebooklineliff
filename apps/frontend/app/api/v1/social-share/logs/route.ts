// SSOT Phase 026 Task 4 — Share-log record proxy (auth passthrough)
// Canonical: apps/frontend/app/api/v1/social-share/logs/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const body = await req.json();
    const res = await fetch(`${backend}/api/v1/social-share/logs`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Share service unavailable' }, { status: 503 });
  }
}
