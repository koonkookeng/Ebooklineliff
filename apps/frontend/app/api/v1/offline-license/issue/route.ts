// SSOT Phase 068 — offline-license proxies (JWT passthrough).
// Canonical: apps/frontend/app/api/v1/offline-license/[issue|status|revoke|quota]/route.ts
import { NextResponse } from 'next/server';

function authHeaders(req: Request, json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['content-type'] = 'application/json';
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function POST(req: Request): Promise<NextResponse> {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tail = new URL(req.url).pathname.split('/api/v1/offline-license/')[1] ?? 'issue';
  const body = await req.json().catch(() => null);
  try {
    const res = await fetch(`${backend}/api/v1/offline-license/${tail}`, {
      method: 'POST',
      headers: authHeaders(req, true),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'License service unavailable' }, { status: 503 });
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tail = url.pathname.split('/api/v1/offline-license/')[1] ?? 'status';
  try {
    const res = await fetch(`${backend}/api/v1/offline-license/${tail}${url.search}`, {
      headers: authHeaders(req, false),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'License service unavailable' }, { status: 503 });
  }
}
