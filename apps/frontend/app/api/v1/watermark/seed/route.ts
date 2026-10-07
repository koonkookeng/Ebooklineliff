// SSOT Phase 042 — Watermark seed proxy (JWT passthrough, Phase 014 pattern)
// Canonical: apps/frontend/app/api/v1/watermark/seed/route.ts
// - GET ?productId= → NestJS GET /api/v1/watermark/seed (same handler as GQL).
// - Seed JSON is <1KB (Gate 6 zero-egress); non-OK passes through so the hook
//   enters ERROR + content lock.
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const productId = new URL(req.url).searchParams.get('productId');
  if (!productId) return NextResponse.json({ message: 'Missing product id' }, { status: 400 });
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/watermark/seed?productId=${encodeURIComponent(productId)}`, { headers: h });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Watermark service unavailable' }, { status: 503 });
  }
}
