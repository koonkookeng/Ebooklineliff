// SSOT Phase 040 Task 40.2 — Entitled reader chunk proxy (JWT passthrough)
// Canonical: apps/frontend/app/api/v1/reader/chunk/route.ts
// - Forwards productId/page (+optional tenantId hint) to the NestJS reader
//   gateway (GET /api/v1/reader/chunk); the backend derives the tenant from
//   the JWT (query is fallback only) and enforces the entitlement gate.
// - Non-OK statuses pass through so the hook enters ERROR + offline fallback.
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const productId = url.searchParams.get('productId');
  const page = url.searchParams.get('page');
  const tenantId = url.searchParams.get('tenantId');
  if (!productId || !page) {
    return NextResponse.json({ message: 'Missing chunk identity' }, { status: 400 });
  }
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const qs = `productId=${encodeURIComponent(productId)}&page=${encodeURIComponent(page)}${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ''}`;
    const res = await fetch(`${backend}/api/v1/reader/chunk?${qs}`, { headers: h });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Reader service unavailable' }, { status: 503 });
  }
}
