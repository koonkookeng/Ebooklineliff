// SSOT Phase 081 — Ledger statements proxy (sharer-self scope)
// Canonical: apps/frontend/app/api/v1/finance/statements/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const limit = url.searchParams.get('limit') ?? '20';
  const offset = url.searchParams.get('offset') ?? '0';
  const headers: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) headers['authorization'] = auth;
  if (cookie) headers['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/finance/statements?limit=${limit}&offset=${offset}`, { headers });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Finance service unavailable' }, { status: 503 });
  }
}
