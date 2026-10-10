// SSOT Phase 114 Task 5 — admin ledger proxy (paginated audit stream)
// Canonical: apps/frontend/app/api/v1/admin/clearing/ledger/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const h: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  const forward = new URLSearchParams();
  for (const k of ['limit', 'offset']) {
    const v = url.searchParams.get(k);
    if (v) forward.set(k, v);
  }
  try {
    const res = await fetch(`${backend}/api/v1/clearinghouse/ledger?${forward.toString()}`, { headers: h });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Ledger stream unavailable' }, { status: 503 });
  }
}
