// SSOT Phase 037 Task 7 — Ebook TOC structure proxy (public)
// Canonical: apps/frontend/app/api/v1/catalog/structure/ebook/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const productId = new URL(req.url).searchParams.get('productId');
  if (!productId) return NextResponse.json({ message: 'Missing product id' }, { status: 400 });
  try {
    const res = await fetch(`${backend}/api/v1/catalog/structure/ebook?productId=${encodeURIComponent(productId)}`, {
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Catalog service unavailable' }, { status: 503 });
  }
}
