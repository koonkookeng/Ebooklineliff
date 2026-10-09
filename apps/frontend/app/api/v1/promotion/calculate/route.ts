// SSOT Phase 088 Task 5 — Promotion proxies (calculate/eligible/balance)
// Canonical: apps/frontend/app/api/v1/promotion/calculate/route.ts
import { NextResponse } from 'next/server';

function passthrough(req: Request, tenant: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const body = await req.json().catch(() => null);
  try {
    const res = await fetch(`${backend}/api/v1/promotion/calculate`, {
      method: 'POST',
      headers: passthrough(req, tenant),
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Promotion service unavailable' }, { status: 503 });
  }
}
