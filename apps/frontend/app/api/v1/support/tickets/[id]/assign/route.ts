// SSOT Phase 103 — Assign ticket proxy (moderator JWT)
// Canonical: apps/frontend/app/api/v1/support/tickets/[id]/assign/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/support/tickets/${encodeURIComponent(params.id)}/assign`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({}),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Support service unavailable' }, { status: 503 });
  }
}