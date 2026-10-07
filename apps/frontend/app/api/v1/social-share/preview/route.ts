// SSOT Phase 026 Task 6 — Viral preview click proxy (public, UA/IP passthrough)
// Canonical: apps/frontend/app/api/v1/social-share/preview/route.ts
// Backend records the click + K-factor event; preview gating (pages 1–10) is
// enforced by the reader entitlement gatekeeper downstream.
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const st = url.searchParams.get('st');
  if (!st) return NextResponse.json({ message: 'Missing share token' }, { status: 400 });
  const h: Record<string, string> = {};
  const ua = req.headers.get('user-agent');
  const fwd = req.headers.get('x-forwarded-for');
  if (ua) h['user-agent'] = ua;
  if (fwd) h['x-forwarded-for'] = fwd;
  try {
    const res = await fetch(`${backend}/api/v1/social-share/preview?st=${encodeURIComponent(st)}`, {
      method: 'GET',
      headers: h,
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Share service unavailable' }, { status: 503 });
  }
}
