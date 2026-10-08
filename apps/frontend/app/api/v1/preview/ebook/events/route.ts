// SSOT Phase 051 §7.1 — preview analytics event proxy (fail-open).
// Canonical: apps/frontend/app/api/v1/preview/ebook/events/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ message: 'Invalid preview event' }, { status: 400 });
  }
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const userId = req.headers.get('x-user-id');
  const lineUserId = req.headers.get('x-line-user-id');
  const cookie = req.headers.get('cookie');
  if (userId) h['x-user-id'] = userId;
  if (lineUserId) h['x-line-user-id'] = lineUserId;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/preview/ebook/events`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ recorded: res.ok }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ recorded: false }, { status: 503 });
  }
}
