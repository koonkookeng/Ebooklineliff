// SSOT Phase 087 — Flash campaign proxy (public read)
// Canonical: apps/frontend/app/api/v1/flash-sale/campaign/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  try {
    const res = await fetch(`${backend}/api/v1/flash-sale/campaign?tenantId=${encodeURIComponent(tenant)}`, {
      headers: { Accept: 'application/json' },
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Flash service unavailable' }, { status: 503 });
  }
}
