// SSOT Phase 032 — Permission audit proxy (JWT passthrough, backend owns Zod)
// Canonical: apps/frontend/app/api/v1/permission/audit/route.ts
import { NextResponse } from 'next/server';

function passthrough(req: Request): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    const res = await fetch(`${backend}/api/v1/permission/audit`, {
      method: 'POST',
      headers: passthrough(req),
      body: JSON.stringify(body),
      keepalive: true,
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Permission service unavailable' }, { status: 503 });
  }
}

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${backend}/api/v1/permission/audit`, { headers: passthrough(req) });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Permission service unavailable' }, { status: 503 });
  }
}
