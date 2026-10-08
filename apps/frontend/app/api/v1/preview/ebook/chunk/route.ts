// SSOT Phase 051 §5.1 — ebook chunk proxy (403 paywall passthrough).
// Canonical: apps/frontend/app/api/v1/preview/ebook/chunk/route.ts
// - Forwards x-user-id / x-line-user-id so the gatekeeper keys per viewer;
//   upstream 403 PREVIEW_LIMIT_EXCEEDED surfaces untouched for the paywall.
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const productId = url.searchParams.get('productId');
  const page = url.searchParams.get('page');
  if (!productId || !page) {
    return NextResponse.json({ message: 'Missing preview chunk request' }, { status: 400 });
  }
  const h: Record<string, string> = {};
  const userId = req.headers.get('x-user-id');
  const lineUserId = req.headers.get('x-line-user-id');
  const cookie = req.headers.get('cookie');
  if (userId) h['x-user-id'] = userId;
  if (lineUserId) h['x-line-user-id'] = lineUserId;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/preview/ebook/chunk?productId=${encodeURIComponent(productId)}&page=${encodeURIComponent(page)}`,
      { headers: h },
    );
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Preview service unavailable' }, { status: 503 });
  }
}
