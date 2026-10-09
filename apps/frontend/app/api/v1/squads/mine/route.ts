// SSOT Phase 096 — Squad mine/detail proxies
// Canonical: apps/frontend/app/api/v1/squads/mine/route.ts
import { NextResponse } from 'next/server';

function forward(req: Request): { backend: string; h: Record<string, string> } {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const h: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return { backend, h };
}

export async function GET(req: Request) {
  const { backend, h } = forward(req);
  try {
    const res = await fetch(`${backend}/api/v1/squads/mine`, { headers: h, cache: 'no-store' });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Squad service unavailable' }, { status: 503 });
  }
}
