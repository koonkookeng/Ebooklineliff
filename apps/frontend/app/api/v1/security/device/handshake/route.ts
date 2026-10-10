// SSOT Phase 119 — device session proxies (handshake/heartbeat/key/evict)
// Canonical: apps/frontend/app/api/v1/security/device/handshake/route.ts
import { NextResponse } from 'next/server';

function postHeaders(req: Request, tenant: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

async function forward(req: Request, path: string, search = '') {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const body = await req.json().catch(() => null);
  const res = await fetch(`${backend}${path}${search}`, { method: 'POST', headers: postHeaders(req, tenant), body: JSON.stringify(body) });
  return NextResponse.json(await res.json().catch(() => null), { status: res.status });
}

export async function POST(req: Request) {
  try {
    return await forward(req, '/api/v1/security/device/handshake');
  } catch {
    return NextResponse.json({ message: 'Device handshake unavailable' }, { status: 503 });
  }
}
