// SSOT Phase 049 — DRM chunk payload proxy (JWT forwarded).
// Canonical: apps/frontend/app/api/drm/chunk/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get('productId');
  const pageNumber = searchParams.get('pageNumber');
  const sessionId = searchParams.get('sessionId');
  if (!productId || !pageNumber || !sessionId) {
    return NextResponse.json({ message: 'Missing productId/pageNumber/sessionId' }, { status: 400 });
  }
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/drm/chunk?productId=${encodeURIComponent(productId)}&pageNumber=${encodeURIComponent(pageNumber)}&sessionId=${encodeURIComponent(sessionId)}`,
      { headers: h },
    );
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'DRM service unavailable' }, { status: 503 });
  }
}
