// SSOT Phase 061 §5.1 — drm-chunk proxy (JWT passthrough, no-store).
// Canonical: apps/frontend/app/api/v1/reader/drm-chunk/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const params = new URL(req.url).searchParams;
  const query = new URLSearchParams();
  for (const k of ['productId', 'page', 'pageNumber', 'gridX', 'gridY', 'algorithm']) {
    const v = params.get(k);
    if (v !== null) query.set(k, v);
  }
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/reader/drm-chunk?${query.toString()}`, { headers: h, cache: 'no-store' });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Reader service unavailable' }, { status: 503 });
  }
}
