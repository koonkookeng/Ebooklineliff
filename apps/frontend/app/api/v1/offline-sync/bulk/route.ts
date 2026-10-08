// SSOT Phase 062 §5.2 — offline-sync bulk proxy (JWT passthrough).
// Canonical: apps/frontend/app/api/v1/offline-sync/bulk/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const body = await req.json().catch(() => null);
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  const device = req.headers.get('x-device-id');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  if (device) h['x-device-id'] = device;
  try {
    const res = await fetch(`${backend}/api/v1/offline-sync/bulk`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ success: false, processedCount: 0, failedIds: [], serverTimestamp: Date.now() }, { status: 202 });
  }
}
