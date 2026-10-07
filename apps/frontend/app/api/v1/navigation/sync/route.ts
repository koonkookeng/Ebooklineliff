// SSOT Phase 027 — Navigation REST proxies (auth/UA passthrough)
// Canonical: apps/frontend/app/api/v1/navigation/sync/route.ts
// (Phase 014/026 precedent: Next proxy → NestJS; backend owns Zod + upsert.)
import { NextResponse } from 'next/server';

function passthrough(req: Request): Record<string, string> {
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  const ua = req.headers.get('user-agent');
  const liffId = req.headers.get('x-liff-id');
  const lineUserId = req.headers.get('x-line-user-id');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  if (ua) h['user-agent'] = ua;
  if (liffId) h['x-liff-id'] = liffId;
  if (lineUserId) h['x-line-user-id'] = lineUserId;
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
    const res = await fetch(`${backend}/api/v1/navigation/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...passthrough(req) },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Navigation service unavailable' }, { status: 503 });
  }
}
