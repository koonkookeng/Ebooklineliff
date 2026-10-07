// SSOT Phase 048 — User certificates list proxy (JWT auth).
// Canonical: apps/frontend/app/api/certificate/my/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;

  try {
    const res = await fetch(`${backend}/api/v1/certificate/my`, { headers: h });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ success: false, message: 'Certificate service unavailable' }, { status: 503 });
  }
}