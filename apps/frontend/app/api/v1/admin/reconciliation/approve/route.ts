// SSOT Phase 115 Task 7 — override approve proxy (checker lane)
// Canonical: apps/frontend/app/api/v1/admin/reconciliation/approve/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const body = await req.json().catch(() => null);
    const res = await fetch(`${backend}/api/v1/admin/reconciliation/approve`, { method: 'POST', headers: h, body: JSON.stringify(body) });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Override approve unavailable' }, { status: 503 });
  }
}
