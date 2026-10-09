// SSOT Phase 106 — Security role matrix proxy (tenant-scoped read/write)
// Canonical: apps/frontend/app/api/v1/security/roles/[roleId]/route.ts
import { NextResponse } from 'next/server';

function forwardHeaders(req: Request, tenantFallback: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenantFallback };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) headers['authorization'] = auth;
  if (cookie) headers['cookie'] = cookie;
  return headers;
}

export async function GET(req: Request, ctx: { params: { roleId: string } }): Promise<NextResponse> {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId') ?? 'default';
  try {
    const res = await fetch(
      `${backend}/api/v1/security/roles/${encodeURIComponent(ctx.params.roleId)}?tenantId=${encodeURIComponent(tenantId)}`,
      { headers: forwardHeaders(req, tenantId) },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Security service unavailable' }, { status: 503 });
  }
}

export async function PUT(req: Request, ctx: { params: { roleId: string } }): Promise<NextResponse> {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId') ?? 'default';
  try {
    const body = await req.json().catch(() => ({}));
    const res = await fetch(`${backend}/api/v1/security/roles/${encodeURIComponent(ctx.params.roleId)}`, {
      method: 'PUT',
      headers: { ...forwardHeaders(req, tenantId), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Security service unavailable' }, { status: 503 });
  }
}
