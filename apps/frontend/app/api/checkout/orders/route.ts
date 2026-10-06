// SSOT Phase 012 §6 — Checkout order proxy (Next.js → NestJS, auth + tenant passthrough)
import { NextResponse } from 'next/server';

function headers(req: Request): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  const tenant = req.headers.get('x-tenant-id') ?? new URL(req.url).searchParams.get('tenantId');
  if (tenant) h['x-tenant-id'] = tenant;
  return h;
}

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const body = await req.json();
    const res = await fetch(`${backend}/api/checkout/orders`, { method: 'POST', headers: headers(req), body: JSON.stringify(body) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Checkout service unavailable' }, { status: 503 });
  }
}