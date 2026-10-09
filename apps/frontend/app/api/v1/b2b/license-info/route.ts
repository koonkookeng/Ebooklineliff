// SSOT Phase 097 — B2B license-info proxy (public code lookup)
// Canonical: apps/frontend/app/api/v1/b2b/license-info/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const code = new URL(req.url).searchParams.get('code') ?? '';
  try {
    const res = await fetch(`${backend}/api/v1/b2b/license-info?code=${encodeURIComponent(code)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'B2B service unavailable' }, { status: 503 });
  }
}
