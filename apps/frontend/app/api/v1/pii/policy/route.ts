// SSOT Phase 107 — PII policy proxy (tenant-scoped read, LIFF masking rules)
// Canonical: apps/frontend/app/api/v1/pii/policy/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request): Promise<NextResponse> {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId') ?? 'default';
  const role = url.searchParams.get('role') ?? 'MEMBER';
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const auth = req.headers.get('authorization');
    const cookie = req.headers.get('cookie');
    if (auth) headers['authorization'] = auth;
    if (cookie) headers['cookie'] = cookie;
    const res = await fetch(
      `${backend}/api/v1/pii/policy?tenantId=${encodeURIComponent(tenantId)}&role=${encodeURIComponent(role)}`,
      { headers },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'PII service unavailable' }, { status: 503 });
  }
}
