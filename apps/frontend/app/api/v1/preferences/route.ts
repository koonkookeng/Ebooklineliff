// SSOT Phase 066 — preferences CRUD proxy (JWT passthrough).
// Canonical: apps/frontend/app/api/v1/preferences/route.ts
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

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${backend}/api/v1/preferences`, { headers: authHeaders(req, false) });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Preference service unavailable' }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const body = await req.json().catch(() => null);
  try {
    const res = await fetch(`${backend}/api/v1/preferences`, {
      method: 'PATCH',
      headers: authHeaders(req, true),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Preference service unavailable' }, { status: 503 });
  }
}
