// SSOT Phase 074 §5/§10 — Builder draft load proxy (100ms hydration)
// Canonical: apps/frontend/app/api/builder/draft/load/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const draftId = url.searchParams.get('draftId') ?? '';
  const headers: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) headers['authorization'] = auth;
  if (cookie) headers['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/builder/draft/load?draftId=${encodeURIComponent(draftId)}`,
      { headers },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Builder service unavailable' }, { status: 503 });
  }
}
