// SSOT Phase 110 §6 — inspector proxies (server-side auth forward)
import { NextResponse } from 'next/server';

export function backendBase(): string {
  return process.env.BACKEND_URL ?? 'http://localhost:4000';
}

export function forwardHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) headers['authorization'] = auth;
  if (cookie) headers['cookie'] = cookie;
  const tenant = req.headers.get('x-tenant-id');
  if (tenant) headers['x-tenant-id'] = tenant;
  return headers;
}

export async function proxyGet(req: Request, path: string): Promise<Response> {
  try {
    const url = new URL(req.url);
    const res = await fetch(`${backendBase()}${path}${url.search}`, { headers: forwardHeaders(req) });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Inspector service unavailable' }, { status: 503 });
  }
}

export async function proxyPost(req: Request, path: string, body?: unknown): Promise<Response> {
  try {
    const headers = { ...forwardHeaders(req), 'Content-Type': 'application/json' };
    const res = await fetch(`${backendBase()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? (await req.json().catch(() => ({})))),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Inspector service unavailable' }, { status: 503 });
  }
}
