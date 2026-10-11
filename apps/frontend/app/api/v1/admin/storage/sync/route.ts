// SSOT Phase 123 Task 7 — lifecycle sync proxy (admin scope)
// Canonical: apps/frontend/app/api/v1/admin/storage/sync/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const h: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const body = await req.json().catch(() => ({}));
    const res = await fetch(`${backend}/api/v1/admin/storage/sync`, { method: 'POST', headers: h, body: JSON.stringify(body) });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Lifecycle sync unavailable' }, { status: 503 });
  }
}
