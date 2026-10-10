// SSOT Phase 117 Task 6 — campaign LIFF proxies (active/validate/claim/stack)
// Canonical: apps/frontend/app/api/v1/campaigns/active/route.ts
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
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  try {
    const res = await fetch(`${backend}/api/v1/campaigns/active`, { headers: getHeaders(req, tenant) });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Campaigns unavailable' }, { status: 503 });
  }
}
