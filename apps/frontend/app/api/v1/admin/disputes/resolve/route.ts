// SSOT Phase 113 Task 7 — admin arbitration resolve/begin proxies
// Canonical: apps/frontend/app/api/v1/admin/disputes/resolve/route.ts
import { NextResponse } from 'next/server';

async function forward(req: Request, path: string) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  const body = await req.json().catch(() => null);
  const res = await fetch(`${backend}${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
  return NextResponse.json(await res.json().catch(() => null), { status: res.status });
}

export async function POST(req: Request) {
  try {
    return await forward(req, '/api/v1/admin/disputes/resolve');
  } catch {
    return NextResponse.json({ message: 'Dispute resolve unavailable' }, { status: 503 });
  }
}
