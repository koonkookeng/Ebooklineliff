// SSOT Phase 011 §6 — Cart read proxy (auth + tenant passthrough)
import { NextResponse } from 'next/server';

function passthrough(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) headers['authorization'] = auth;
  if (cookie) headers['cookie'] = cookie;
  const tenant = req.headers.get('x-tenant-id') ?? new URL(req.url).searchParams.get('tenantId');
  if (tenant) headers['x-tenant-id'] = tenant;
  return headers;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(
      `${backend}/api/cart?${url.searchParams.toString()}`,
      { headers: passthrough(req) },
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Cart service unavailable' }, { status: 503 });
  }
}
