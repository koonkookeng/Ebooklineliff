// SSOT Phase 009 §6.1 — Catalog faceted-search proxy (URL-synced, ISR-friendly)
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${backend}/api/search/catalog?${url.searchParams.toString()}`, {
      headers: {
        'x-tenant-id': req.headers.get('x-tenant-id') ?? '',
      },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { items: [], facets: [], totalCount: 0, hasNextPage: false, nextCursor: null },
      { status: 200 },
    );
  }
}
