// SSOT Phase 129 §5 — PDPA consent proxy (JWT cookie passthrough)
// Canonical: apps/frontend/app/api/v1/pdpa/consent/route.ts
// (Phase 029 performance-proxy precedent; backend owns Zod + identity bind.)
import { NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:4000';

function forwardHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function GET(req: Request) {
  try {
    const res = await fetch(`${BACKEND}/api/v1/pdpa/consent/status`, {
      method: 'GET',
      headers: forwardHeaders(req),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Consent service unavailable' }, { status: 503 });
  }
}

export async function PUT(req: Request) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    const res = await fetch(`${BACKEND}/api/v1/pdpa/consent`, {
      method: 'PUT',
      headers: forwardHeaders(req),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Consent service unavailable' }, { status: 503 });
  }
}
