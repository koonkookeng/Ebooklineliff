// SSOT Phase 025 Task 3 — Resolver resolve proxy (public; UA/IP passthrough)
// Canonical: apps/frontend/app/api/v1/resolver/resolve/route.ts
// Forwards user-agent + client IP so the backend classifier (detectEnvironment)
// and rate limiter see the real caller, not the proxy.
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) return NextResponse.json({ message: 'Missing short code' }, { status: 400 });
  const h: Record<string, string> = {};
  const ua = req.headers.get('user-agent');
  const ref = req.headers.get('referer');
  const fwd = req.headers.get('x-forwarded-for');
  if (ua) h['user-agent'] = ua;
  if (ref) h['referer'] = ref;
  if (fwd) h['x-forwarded-for'] = fwd;
  try {
    const res = await fetch(
      `${backend}/api/v1/resolver/resolve?code=${encodeURIComponent(code)}`,
      { method: 'GET', headers: h },
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Resolver service unavailable' }, { status: 503 });
  }
}
