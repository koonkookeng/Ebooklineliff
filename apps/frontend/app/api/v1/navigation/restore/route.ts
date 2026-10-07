// SSOT Phase 027 — Navigation restore proxy (auth/UA passthrough)
// Canonical: apps/frontend/app/api/v1/navigation/restore/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  const ua = req.headers.get('user-agent');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  if (ua) h['user-agent'] = ua;
  try {
    const res = await fetch(`${backend}/api/v1/navigation/restore?${qs}`, {
      method: 'GET',
      headers: h,
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Navigation service unavailable' }, { status: 503 });
  }
}

export async function DELETE(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  try {
    const res = await fetch(`${backend}/api/v1/navigation/session?${qs}`, { method: 'DELETE' });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Navigation service unavailable' }, { status: 503 });
  }
}
