// SSOT Phase 123 Task 7 — lifecycle rules proxy (admin scope)
// Canonical: apps/frontend/app/api/v1/admin/storage/rules/route.ts
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
  const bucket = url.searchParams.get('bucket') ?? 'omni-commerce-vault';
  try {
    const res = await fetch(
      `${backend}/api/v1/admin/storage/rules?bucketName=${encodeURIComponent(bucket)}`,
      { headers: getHeaders(req, tenant) },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Lifecycle rules unavailable' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  try {
    const body = await req.json().catch(() => ({}));
    const res = await fetch(`${backend}/api/v1/admin/storage/rules`, {
      method: 'POST',
      headers: { ...getHeaders(req, tenant), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Lifecycle update unavailable' }, { status: 503 });
  }
}
