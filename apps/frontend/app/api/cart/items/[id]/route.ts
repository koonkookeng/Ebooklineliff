// SSOT Phase 011 §6 — Cart item update/remove proxy
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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const body = await req.json();
    const res = await fetch(`${backend}/api/cart/items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: passthrough(req),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Cart service unavailable' }, { status: 503 });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${backend}/api/cart/items/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: passthrough(req),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Cart service unavailable' }, { status: 503 });
  }
}
