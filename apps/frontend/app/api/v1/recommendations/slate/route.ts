// SSOT Phase 104 — Recommendation slate proxy (member JWT + tenant)
// Canonical: apps/frontend/app/api/v1/recommendations/slate/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const limit = url.searchParams.get('limit') ?? '6';
  const h: Record<string, string> = { 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/recommendations/slate?limit=${encodeURIComponent(limit)}`, { headers: h });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Recommendation service unavailable' }, { status: 503 });
  }
}
