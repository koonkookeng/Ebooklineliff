// SSOT Phase 101 — Raise-queue proxy (moderator JWT)
// Canonical: apps/frontend/app/api/v1/live/sessions/[id]/raise-queue/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const h: Record<string, string> = { 'x-tenant-id': new URL(req.url).searchParams.get('tenant') ?? 'default' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/live/sessions/${encodeURIComponent(params.id)}/raise-queue`, { headers: h });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Live service unavailable' }, { status: 503 });
  }
}
