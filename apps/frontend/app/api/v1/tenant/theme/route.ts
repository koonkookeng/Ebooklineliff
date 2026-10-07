// SSOT Phase 030 Task 5 — Tenant theme proxy (public GET + authed PUT)
// Canonical: apps/frontend/app/api/v1/tenant/theme/route.ts
// - GET ?slug= is public (branding carries no PII; middleware bypasses it).
// - PUT forwards admin updates with auth passthrough (backend owns Zod + AA).
import { NextResponse } from 'next/server';

function passthrough(req: Request): Record<string, string> {
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  if (!slug) return NextResponse.json({ message: 'Missing tenant slug' }, { status: 400 });
  try {
    const res = await fetch(`${backend}/api/v1/tenant/theme?slug=${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Theme service unavailable' }, { status: 503 });
  }
}

export async function PUT(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    const res = await fetch(`${backend}/api/v1/tenant/theme`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...passthrough(req) },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Theme service unavailable' }, { status: 503 });
  }
}
