// SSOT Phase 009 §6.1 — LIFF predictive proxy (tenant header passthrough, R2 zero-egress images)
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const limit = url.searchParams.get('limit') ?? '5';
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(
      `${backend}/api/search/predictive?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`,
      {
        headers: {
          'x-tenant-id': req.headers.get('x-tenant-id') ?? '',
        },
      },
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
