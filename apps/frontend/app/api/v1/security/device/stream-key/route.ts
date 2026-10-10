// SSOT Phase 119 — stream-key + evict + devices proxies
// Canonical: apps/frontend/app/api/v1/security/device/stream-key/route.ts
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
  const sessionToken = url.searchParams.get('sessionToken') ?? '';
  const lessonId = url.searchParams.get('lessonId') ?? '';
  try {
    const res = await fetch(
      `${backend}/api/v1/security/device/stream-key?sessionToken=${encodeURIComponent(sessionToken)}&lessonId=${encodeURIComponent(lessonId)}`,
      { headers: getHeaders(req, tenant) },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Stream key unavailable' }, { status: 503 });
  }
}
