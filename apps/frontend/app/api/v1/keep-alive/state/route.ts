// SSOT Phase 031 Task 8 — Keep-alive restore proxy (JWT cookie passthrough)
// Canonical: apps/frontend/app/api/v1/keep-alive/state/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  if (!url.searchParams.get('viewportType')) {
    return NextResponse.json({ message: 'Missing viewport type' }, { status: 400 });
  }
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/keep-alive/state?${qs}`, { headers: h });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Keep-alive service unavailable' }, { status: 503 });
  }
}
