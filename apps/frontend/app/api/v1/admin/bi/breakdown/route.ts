// SSOT Phase 116 — revenue breakdown proxy
// Canonical: apps/frontend/app/api/v1/admin/bi/breakdown/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const timeRange = url.searchParams.get('timeRange') ?? 'LAST_30_DAYS';
  const h: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/admin/analytics/breakdown?timeRange=${encodeURIComponent(timeRange)}`,
      { headers: h },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Revenue breakdown unavailable' }, { status: 503 });
  }
}
