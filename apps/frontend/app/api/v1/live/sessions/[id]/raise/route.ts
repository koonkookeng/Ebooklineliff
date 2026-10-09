// SSOT Phase 101 — Hand-raise proxy (member JWT, debounced client-side)
// Canonical: apps/frontend/app/api/v1/live/sessions/[id]/raise/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-tenant-id': new URL(req.url).searchParams.get('tenant') ?? 'default' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/live/sessions/${encodeURIComponent(params.id)}/raise`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({}),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Live service unavailable' }, { status: 503 });
  }
}
