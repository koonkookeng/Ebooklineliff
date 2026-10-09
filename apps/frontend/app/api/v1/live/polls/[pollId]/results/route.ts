// SSOT Phase 101 — Poll results proxy (member JWT)
// Canonical: apps/frontend/app/api/v1/live/polls/[pollId]/results/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request, { params }: { params: { pollId: string } }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const h: Record<string, string> = { 'x-tenant-id': new URL(req.url).searchParams.get('tenant') ?? 'default' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/live/polls/${encodeURIComponent(params.pollId)}/results`, { headers: h });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Live service unavailable' }, { status: 503 });
  }
}
