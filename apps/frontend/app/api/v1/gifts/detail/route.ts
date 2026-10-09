// SSOT Phase 089 — Gift detail + mine proxies
// Canonical: apps/frontend/app/api/v1/gifts/detail/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const code = new URL(req.url).searchParams.get('code') ?? '';
  try {
    const res = await fetch(`${backend}/api/v1/gifts/detail?code=${encodeURIComponent(code)}`, {
      headers: { Accept: 'application/json' },
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Gift service unavailable' }, { status: 503 });
  }
}
