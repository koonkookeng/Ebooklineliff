// SSOT Phase 109 §6 — admin user action proxy
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = req.headers.get('authorization');
    const cookie = req.headers.get('cookie');
    if (auth) headers['authorization'] = auth;
    if (cookie) headers['cookie'] = cookie;
    const tenant = req.headers.get('x-tenant-id');
    if (tenant) headers['x-tenant-id'] = tenant;
    const res = await fetch(`${backend}/api/v1/admin/users/actions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(await req.json()),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Admin user service unavailable' }, { status: 503 });
  }
}
