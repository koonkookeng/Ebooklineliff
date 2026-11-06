import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL =
  process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const headers: Record<string, string> = {
      'Content-Type': req.headers.get('content-type') ?? 'application/json',
    };
    const authorization = req.headers.get('authorization');
    if (authorization) headers.Authorization = authorization;
    const cookie = req.headers.get('cookie');
    if (cookie) headers.Cookie = cookie;
    const tenant = req.headers.get('x-tenant-id');
    if (tenant) headers['X-Tenant-Id'] = tenant;

    const res = await fetch(`${BACKEND_URL}/graphql`, {
      method: 'POST',
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json({ errors: [{ message: 'GraphQL upstream unavailable' }] }, { status: 502 });
  }
}
