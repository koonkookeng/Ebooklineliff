// SSOT Phase 095 — Social notes page proxy (member JWT)
// Canonical: apps/frontend/app/api/v1/social-notes/page/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const ebookId = url.searchParams.get('ebookId') ?? '';
  const page = url.searchParams.get('page') ?? '1';
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const h: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/social-notes/page?ebookId=${encodeURIComponent(ebookId)}&page=${encodeURIComponent(page)}`,
      { headers: h, cache: 'no-store' },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Social notes unavailable' }, { status: 503 });
  }
}
