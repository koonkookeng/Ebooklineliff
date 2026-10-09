// SSOT Phase 097 Task 7 — B2B dashboard proxy (HR JWT)
// Canonical: apps/frontend/app/api/v1/b2b/dashboard/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const corporateAccountId = url.searchParams.get('corporateAccountId') ?? '';
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const h: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/b2b/dashboard?corporateAccountId=${encodeURIComponent(corporateAccountId)}`,
      { headers: h, cache: 'no-store' },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'B2B service unavailable' }, { status: 503 });
  }
}
