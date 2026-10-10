// SSOT Phase 115 Task 7 — reconciliation read proxies (statements/kpi/chain)
// Canonical: apps/frontend/app/api/v1/admin/reconciliation/statements/route.ts
import { NextResponse } from 'next/server';

function getHeaders(req: Request, tenant: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
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
  const forward = new URLSearchParams();
  for (const k of ['status', 'page', 'limit']) {
    const v = url.searchParams.get(k);
    if (v) forward.set(k, v);
  }
  try {
    const res = await fetch(`${backend}/api/v1/admin/reconciliation/statements?${forward.toString()}`, { headers: getHeaders(req, tenant) });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Reconciliation queue unavailable' }, { status: 503 });
  }
}
