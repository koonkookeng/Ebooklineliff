// SSOT Phase 125 Task 6 §6.1 — edge reader chunk proxy (region echo)
// Canonical: apps/frontend/app/api/edge/reader/chunk/route.ts
// - Forwards to the backend reader-chunk lane and stamps the serving
//   region (EDGE_REGION; Cloudflare sets CF-IPCountry upstream). The
//   x-client-intent header marks EBOOK_READ for edge analytics.
// - Zero new deps.
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const productId = url.searchParams.get('productId') ?? '';
  const page = url.searchParams.get('page') ?? '1';
  if (!productId) return NextResponse.json({ message: 'productId required' }, { status: 400 });
  const headers: Record<string, string> = { Accept: 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  const intent = req.headers.get('x-client-intent');
  if (auth) headers['authorization'] = auth;
  if (cookie) headers['cookie'] = cookie;
  if (intent) headers['x-client-intent'] = intent;
  const country = req.headers.get('cf-ipcountry') ?? req.headers.get('x-client-country') ?? '';
  if (country) headers['x-client-country'] = country;
  try {
    // Same backend lane as the existing reader proxy (api/reader/chunk).
    const res = await fetch(
      `${backend}/api/reader/chunk?productId=${encodeURIComponent(productId)}&page=${encodeURIComponent(page)}`,
      { headers },
    );
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !data) return NextResponse.json(data ?? { message: 'Chunk unavailable' }, { status: res.status });
    return NextResponse.json({
      ...data,
      pageNumber: Number(page),
      servedFromRegion: process.env['EDGE_REGION'] ?? 'ASIA_SOUTHEAST_SINGAPORE',
    });
  } catch {
    return NextResponse.json({ message: 'Edge chunk unavailable' }, { status: 503 });
  }
}
