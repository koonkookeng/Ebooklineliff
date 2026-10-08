// SSOT Phase 065 Task 4 — notes search/summary/export/sync proxies.
// Canonical: apps/frontend/app/api/v1/notes/[search|summary|export|sync]/route.ts
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
  const tail = new URL(req.url).pathname.split('/api/v1/notes/')[1] ?? 'sync';
  const body = await req.json().catch(() => null);
  try {
    const res = await fetch(`${backend}/api/v1/notes/${tail}`, {
      method: 'POST',
      headers: authHeaders(req, true),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ synced: 0 }, { status: 202 });
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tail = url.pathname.split('/api/v1/notes/')[1] ?? 'summary';
  try {
    const res = await fetch(`${backend}/api/v1/notes/${tail}${url.search}`, {
      headers: authHeaders(req, false),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Note service unavailable' }, { status: 503 });
  }
}
