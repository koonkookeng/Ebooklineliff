// SSOT Phase 060 Task 2/4 — retina-chunk proxy (DPR variant passthrough).
// Canonical: apps/frontend/app/api/v1/reader/retina-chunk/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const params = new URL(req.url).searchParams;
  const query = new URLSearchParams();
  for (const k of ['productId', 'page', 'pageNumber', 'deviceDpr', 'dpr', 'cssWidth', 'width', 'cssHeight', 'height']) {
    const v = params.get(k);
    if (v !== null) query.set(k, v);
  }
  const h: Record<string, string> = {};
  const userId = req.headers.get('x-user-id');
  const cookie = req.headers.get('cookie');
  if (userId) h['x-user-id'] = userId;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/reader/retina-chunk?${query.toString()}`, { headers: h, cache: 'no-store' });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Reader service unavailable' }, { status: 503 });
  }
}
