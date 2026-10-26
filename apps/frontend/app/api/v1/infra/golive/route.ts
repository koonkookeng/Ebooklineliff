// SSOT Phase 130 §5.2 — readiness BFF (redacted passthrough)
// Canonical: apps/frontend/app/api/v1/infra/golive/route.ts
// - The Phase 127 /api/v1/infra/health proxy reports replica routing only;
//   the 5-state client needs the canonical db+redis readiness verdict.
// - Never leaks hosts/DSNs/secrets: the backend already returns a redacted
//   envelope and this route forwards it verbatim.
import { NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:4000';

export async function GET() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${BACKEND}/healthz/readiness`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ status: 'CRITICAL_FAILURE', reachable: false }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}
