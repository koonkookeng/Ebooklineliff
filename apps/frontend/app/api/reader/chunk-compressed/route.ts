// SSOT Phase 055 §6.1 — compressed chunk proxy (JWT forward, no caching).
// Canonical: apps/frontend/app/api/reader/chunk-compressed/route.ts
// - Mirrors the chunk proxy (Phase 039) + network/format params for the
//   low-bandwidth engine. Auth headers ride along for the JWT-guarded
//   backend gateway; 4xx/5xx pass through for ERROR + retry handling.
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const productId = url.searchParams.get('productId');
  const page = url.searchParams.get('page');
  const network = url.searchParams.get('network') ?? 'GOOD_3G';
  const format = url.searchParams.get('format') ?? 'BROTLI';
  if (!productId || !page) {
    return NextResponse.json({ message: 'Missing chunk identity' }, { status: 400 });
  }
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const qs =
      `productId=${encodeURIComponent(productId)}&page=${encodeURIComponent(page)}` +
      `&network=${encodeURIComponent(network)}&format=${encodeURIComponent(format)}`;
    const res = await fetch(`${backend}/api/v1/reader/chunk-compressed?${qs}`, { headers: h });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Compressed chunk unavailable' }, { status: 503 });
  }
}
