// SSOT Phase 035 Task 4 — Latest-audit proxy (JWT passthrough)
// Canonical: apps/frontend/app/api/v1/line-sandbox/latest/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const qs = new URL(req.url).searchParams.toString();
  if (!new URL(req.url).searchParams.get('tenantId')) {
    return NextResponse.json({ message: 'Missing tenant id' }, { status: 400 });
  }
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/line-sandbox/audits/latest?${qs}`, { headers: h });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Sandbox service unavailable' }, { status: 503 });
  }
}
