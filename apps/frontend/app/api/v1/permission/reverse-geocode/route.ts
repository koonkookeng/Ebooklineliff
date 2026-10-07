// SSOT Phase 032 — Reverse-geocode proxy (JWT passthrough, 800ms budget)
// Canonical: apps/frontend/app/api/v1/permission/reverse-geocode/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  if (!url.searchParams.get('lat') || !url.searchParams.get('lng')) {
    return NextResponse.json({ message: 'Missing coordinates' }, { status: 400 });
  }
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/permission/reverse-geocode?${qs}`, { headers: h });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Permission service unavailable' }, { status: 503 });
  }
}
