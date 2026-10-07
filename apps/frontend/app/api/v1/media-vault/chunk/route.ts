// SSOT Phase 036 Task 6 — Vault chunk proxy (JWT passthrough, edge-first)
// Canonical: apps/frontend/app/api/v1/media-vault/chunk/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const productId = url.searchParams.get('productId');
  const page = url.searchParams.get('page');
  if (!productId || !page) return NextResponse.json({ message: 'Missing chunk identity' }, { status: 400 });
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/media-vault/ebook-chunk/${encodeURIComponent(productId)}/page/${encodeURIComponent(page)}`,
      { headers: h },
    );
    const data = await res.json().catch(() => null);
    const out = NextResponse.json(data, { status: res.status });
    const egress = res.headers.get('X-Zero-Egress-Verified');
    if (egress) out.headers.set('X-Zero-Egress-Verified', egress);
    return out;
  } catch {
    return NextResponse.json({ message: 'Vault service unavailable' }, { status: 503 });
  }
}
