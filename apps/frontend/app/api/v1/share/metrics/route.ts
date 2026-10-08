// SSOT Phase 080 — Share metrics proxy (sharer-self scope)
// Canonical: apps/frontend/app/api/v1/share/metrics/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const productId = url.searchParams.get('productId');
  const headers: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) headers['authorization'] = auth;
  if (cookie) headers['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/share/metrics${productId ? `?productId=${encodeURIComponent(productId)}` : ''}`,
      { headers },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Share service unavailable' }, { status: 503 });
  }
}
