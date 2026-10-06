// SSOT Phase 011 §6 — Cart add-item proxy
import { NextResponse } from 'next/server';

function passthrough(req: Request): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) headers['authorization'] = auth;
  if (cookie) headers['cookie'] = cookie;
  const tenant = req.headers.get('x-tenant-id');
  if (tenant) headers['x-tenant-id'] = tenant;
  return headers;
}

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const body = await req.json();
    const res = await fetch(`${backend}/api/cart/items`, {
      method: 'POST',
      headers: passthrough(req),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Cart service unavailable' }, { status: 503 });
  }
}
