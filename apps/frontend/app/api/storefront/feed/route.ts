// SSOT Phase 010 §6 — Storefront feed proxy (tenant passthrough, cached 5 min upstream)
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId') ?? req.headers.get('x-tenant-id') ?? '';
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${backend}/api/storefront/feed?tenantId=${encodeURIComponent(tenantId)}`, {
      headers: { 'x-tenant-id': tenantId },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { banners: [], categories: [], featuredProducts: [], bestsellerProducts: [], newReleases: [] },
      { status: 200 },
    );
  }
}
