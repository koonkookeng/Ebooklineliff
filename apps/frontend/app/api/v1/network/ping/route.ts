// SSOT Phase 069 — network ping proxy (no-store passthrough, <100 bytes).
// Canonical: apps/frontend/app/api/v1/network/ping/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenantId = new URL(req.url).searchParams.get('tenantId');
  try {
    const res = await fetch(
      `${backend}/api/v1/network/ping${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`,
      { cache: 'no-store' },
    );
    const data = await res.json().catch(() => null);
    const out = NextResponse.json(data, { status: res.status });
    out.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    return out;
  } catch {
    return NextResponse.json({ message: 'Network service unavailable' }, { status: 503 });
  }
}
