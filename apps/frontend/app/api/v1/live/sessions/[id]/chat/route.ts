// SSOT Phase 099 BDD-2 — Live chat history/post proxy (member JWT)
// Canonical: apps/frontend/app/api/v1/live/sessions/[id]/chat/route.ts
import { NextResponse } from 'next/server';

function forward(req: Request): Record<string, string> {
  const h: Record<string, string> = { 'x-tenant-id': new URL(req.url).searchParams.get('tenant') ?? 'default' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${backend}/api/v1/live/sessions/${encodeURIComponent(params.id)}/chat`, {
      headers: forward(req),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Live service unavailable' }, { status: 503 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const body = await req.json().catch(() => null);
  try {
    const res = await fetch(`${backend}/api/v1/live/sessions/${encodeURIComponent(params.id)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...forward(req) },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Live service unavailable' }, { status: 503 });
  }
}
