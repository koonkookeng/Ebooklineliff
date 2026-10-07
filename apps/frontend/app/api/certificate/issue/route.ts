// SSOT Phase 048 — Certificate issuance proxy (JWT auth, creator/admin).
// Canonical: apps/frontend/app/api/certificate/issue/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const body = await req.json().catch(() => null);

  if (!body || typeof body !== 'object' || !('courseId' in body)) {
    return NextResponse.json({ success: false, message: 'Missing courseId' }, { status: 400 });
  }

  const h: Record<string, string> = { 'content-type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;

  try {
    const res = await fetch(`${backend}/api/v1/certificate/issue`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ success: false, message: 'Certificate service unavailable' }, { status: 503 });
  }
}