// SSOT Phase 029 Task 8 — RUM telemetry proxy (public beacon → NestJS sink)
// Canonical: apps/frontend/app/api/v1/performance/telemetry/route.ts
// (Phase 028 csp-report proxy precedent: body capped, backend owns validation.)
import { NextResponse } from 'next/server';

const MAX_BYTES = 64 * 1024;

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ success: false }, { status: 200 });
  }
  if (!raw || raw.length > MAX_BYTES) return NextResponse.json({ success: false }, { status: 200 });
  try {
    const res = await fetch(`${backend}/api/v1/performance/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    });
    const data = await res.json().catch(() => ({ success: res.ok }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Performance service unavailable' }, { status: 503 });
  }
}
