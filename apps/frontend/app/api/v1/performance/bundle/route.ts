// SSOT Phase 029 Task 3 — Bundle guard status proxy (public CI badge read)
// Canonical: apps/frontend/app/api/v1/performance/bundle/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${backend}/api/v1/performance/bundle`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Performance service unavailable' }, { status: 503 });
  }
}
