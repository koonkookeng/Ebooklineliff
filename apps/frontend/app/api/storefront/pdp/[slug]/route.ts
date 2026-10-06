// SSOT Phase 010 §6 — PDP proxy (slug detail, tenant passthrough)
import { NextResponse } from 'next/server';

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId') ?? req.headers.get('x-tenant-id') ?? '';
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(
      `${backend}/api/storefront/pdp/${encodeURIComponent(slug)}?tenantId=${encodeURIComponent(tenantId)}`,
      { headers: { 'x-tenant-id': tenantId } },
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Product not found or unavailable' }, { status: 404 });
  }
}
