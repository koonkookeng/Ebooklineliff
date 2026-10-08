// SSOT Phase 059 §7.1 — navigation-event proxy (202 beacon, JWT passthrough).
// Canonical: apps/frontend/app/api/v1/reader/navigation-event/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const body = await req.json().catch(() => null);
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/reader/navigation-event`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ recorded: res.ok }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ recorded: false }, { status: 202 });
  }
}
