// SSOT Phase 097 — B2B proxies (HR/member JWT idiom)
// Canonical: apps/frontend/app/api/v1/b2b/license/route.ts
import { NextResponse } from 'next/server';

function headersOf(req: Request): { backend: string; h: Record<string, string>; tenant: string } {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return { backend, h, tenant };
}

export async function POST(req: Request) {
  const { backend, h } = headersOf(req);
  const body = await req.json().catch(() => null);
  try {
    const res = await fetch(`${backend}/api/v1/b2b/license`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'B2B service unavailable' }, { status: 503 });
  }
}
