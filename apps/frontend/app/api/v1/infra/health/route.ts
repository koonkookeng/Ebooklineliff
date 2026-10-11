// SSOT Phase 127 §2 — DR health proxy (fail-open passthrough)
// Canonical: apps/frontend/app/api/v1/infra/health/route.ts
// (Phase 029 performance-proxy precedent; backend owns the redacted verdict.)
import { NextResponse } from 'next/server';

export async function GET() {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${backend}/api/v1/infra/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ reachable: false }, { status: 503 });
  }
}
