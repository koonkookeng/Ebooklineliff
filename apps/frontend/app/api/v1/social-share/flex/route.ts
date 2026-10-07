// SSOT Phase 026 Task 4 — Social-share REST proxies (auth/UA passthrough)
// Canonical: apps/frontend/app/api/v1/social-share/flex/route.ts
import { NextResponse } from 'next/server';

function passthrough(req: Request): Record<string, string> {
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  const ua = req.headers.get('user-agent');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  if (ua) h['user-agent'] = ua;
  return h;
}

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  if (!url.searchParams.get('productId') || !url.searchParams.get('contentType')) {
    return NextResponse.json({ message: 'Missing share input' }, { status: 400 });
  }
  try {
    const res = await fetch(`${backend}/api/v1/social-share/flex?${qs}`, {
      method: 'GET',
      headers: passthrough(req),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Share service unavailable' }, { status: 503 });
  }
}
