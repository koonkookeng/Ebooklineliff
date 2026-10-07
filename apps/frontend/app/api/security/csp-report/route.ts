// SSOT Phase 028 §7.1 — CSP report frontend proxy (public beacon → NestJS sink)
// Canonical: apps/frontend/app/api/security/csp-report/route.ts
// - Browsers POST native `{"csp-report": {...}}` via report-uri (no authcookies
//   guaranteed — middleware bypasses this path, Phase 028).
// - Proxy caps the body at 64KB (CSP_MAX_BYTES, Gate 5) and forwards raw bytes;
//   validation + severity + sinks live in the backend CspReportController.
// - Always 204 (beacon semantics; never leak policy shape to reporters).
import { NextResponse } from 'next/server';

const MAX_BYTES = 64 * 1024;

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > MAX_BYTES) return new NextResponse(null, { status: 204 });
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (raw.length > MAX_BYTES || !raw) return new NextResponse(null, { status: 204 });
  try {
    // NOTE: forward as application/json (raw JSON bytes preserved) — the Nest
    // Fastify body parser only parses JSON content types; application/csp-report
    // would arrive as undefined and the report would be silently dropped.
    await fetch(`${backend}/api/v1/security/csp-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    }).catch(() => undefined);
  } catch {
    // Backend down: beacon still 204 (report loss is acceptable, edge is best-effort).
  }
  return new NextResponse(null, { status: 204 });
}
