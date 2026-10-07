// SSOT Phase 034 Task 6 — OA public config proxy (logged-out LIFF opens)
// Canonical: apps/frontend/app/api/v1/line-oa/config/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  try {
    const res = await fetch(`${backend}/api/v1/line-oa/config?${qs}`, {
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'OA service unavailable' }, { status: 503 });
  }
}
