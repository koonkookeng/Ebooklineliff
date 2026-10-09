// SSOT Phase 096 BDD-3 — Leaderboard proxy (member JWT idiom)
// Canonical: apps/frontend/app/api/v1/leaderboard/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') ?? 'GLOBAL';
  const timeframe = url.searchParams.get('timeframe') ?? 'WEEKLY';
  const limit = url.searchParams.get('limit') ?? '50';
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const h: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/leaderboard?scope=${encodeURIComponent(scope)}&timeframe=${encodeURIComponent(timeframe)}&limit=${encodeURIComponent(limit)}`,
      { headers: h, cache: 'no-store' },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Leaderboard unavailable' }, { status: 503 });
  }
}
