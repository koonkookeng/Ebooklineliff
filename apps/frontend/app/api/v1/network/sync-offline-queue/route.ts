// SSOT Phase 069 BDD-2 — offline queue + telemetry proxies (JWT passthrough).
// Canonical: apps/frontend/app/api/v1/network/[sync-offline-queue|telemetry]/route.ts
import { NextResponse } from 'next/server';

function authHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function POST(req: Request): Promise<NextResponse> {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tail = new URL(req.url).pathname.split('/api/v1/network/')[1] ?? 'sync-offline-queue';
  const body = await req.json().catch(() => null);
  try {
    const res = await fetch(`${backend}/api/v1/network/${tail}`, {
      method: 'POST',
      headers: authHeaders(req),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ success: false, processedCount: 0, failedItemIds: [] }, { status: 202 });
  }
}
