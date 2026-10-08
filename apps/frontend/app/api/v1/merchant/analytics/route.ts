// SSOT Phase 073 §6 — Merchant proxy (auth passthrough to NestJS)
// Canonical: apps/frontend/app/api/v1/merchant/analytics/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const headers: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) headers['authorization'] = auth;
  if (cookie) headers['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/merchant/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Merchant service unavailable' }, { status: 503 });
  }
}
