// SSOT Phase 034 Task 6 — OA friendship proxies (JWT passthrough)
// Canonical: apps/frontend/app/api/v1/line-oa/friendship/route.ts
import { NextResponse } from 'next/server';

function passthrough(req: Request): Record<string, string> {
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const qs = new URL(req.url).searchParams.toString();
  try {
    const res = await fetch(`${backend}/api/v1/line-oa/friendship?${qs}`, { headers: passthrough(req) });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'OA service unavailable' }, { status: 503 });
  }
}
