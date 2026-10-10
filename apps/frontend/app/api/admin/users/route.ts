// SSOT Phase 109 §6 — admin users list proxy (server-side, forwards auth)
import { NextResponse } from 'next/server';

function passthrough(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) headers['authorization'] = auth;
  if (cookie) headers['cookie'] = cookie;
  const tenant = req.headers.get('x-tenant-id');
  if (tenant) headers['x-tenant-id'] = tenant;
  return headers;
}

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const url = new URL(req.url);
    const res = await fetch(`${backend}/api/v1/admin/users${url.search}`, { headers: passthrough(req) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Admin user service unavailable' }, { status: 503 });
  }
}
