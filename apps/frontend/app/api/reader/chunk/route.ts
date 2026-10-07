// SSOT Phase 039 Task 39.5 — Reader chunk proxy (public LIFF read, edge-first)
// Canonical: apps/frontend/app/api/reader/chunk/route.ts
// - Forwards tenantId/productId/page to the NestJS edge gateway
//   (GET /api/reader/chunk); no auth round-trip so canvas renders <10ms.
// - 404/503 pass through so the hook can enter ERROR + IndexedDB fallback.
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId');
  const productId = url.searchParams.get('productId');
  const page = url.searchParams.get('page');
  if (!tenantId || !productId || !page) {
    return NextResponse.json({ message: 'Missing chunk identity' }, { status: 400 });
  }
  try {
    const res = await fetch(
      `${backend}/api/reader/chunk?tenantId=${encodeURIComponent(tenantId)}&productId=${encodeURIComponent(productId)}&page=${encodeURIComponent(page)}`,
    );
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Edge chunk unavailable' }, { status: 503 });
  }
}
