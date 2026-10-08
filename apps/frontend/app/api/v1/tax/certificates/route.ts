// SSOT Phase 082 — Certificates list + generate proxies (self scope)
// Canonical: apps/frontend/app/api/v1/tax/certificates/route.ts
import { NextResponse } from 'next/server';

function passthrough(req: Request): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const limit = url.searchParams.get('limit') ?? '20';
  try {
    const res = await fetch(`${backend}/api/v1/tax/certificates?limit=${limit}`, {
      headers: { Accept: 'application/json', 'x-tenant-id': tenant, ...passthrough(req) },
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Tax service unavailable' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const body = await req.json().catch(() => null);
  try {
    const res = await fetch(`${backend}/api/v1/tax/certificates/generate`, {
      method: 'POST',
      headers: { 'x-tenant-id': tenant, ...passthrough(req) },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Tax service unavailable' }, { status: 503 });
  }
}
