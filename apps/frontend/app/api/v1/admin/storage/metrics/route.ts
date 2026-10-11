// SSOT Phase 123 Task 7 — storage metrics proxy (admin scope)
// Canonical: apps/frontend/app/api/v1/admin/storage/metrics/route.ts
import { NextResponse } from 'next/server';

function getHeaders(req: Request, tenant: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant') ?? 'default';
  try {
    const res = await fetch(
      `${backend}/api/v1/admin/storage/metrics?tenantId=${encodeURIComponent(tenant)}`,
      { headers: getHeaders(req, tenant) },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Storage metrics unavailable' }, { status: 503 });
  }
}
