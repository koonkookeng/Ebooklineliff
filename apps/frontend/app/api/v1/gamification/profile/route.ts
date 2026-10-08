// SSOT Phase 083 — Gamification read proxies (profile/badges/catalog)
// Canonical: apps/frontend/app/api/v1/gamification/profile/route.ts
import { NextResponse } from 'next/server';

function authHeaders(req: Request, tenant: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  try {
    const res = await fetch(`${backend}/api/v1/gamification/profile`, { headers: authHeaders(req, tenant) });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Gamification service unavailable' }, { status: 503 });
  }
}
