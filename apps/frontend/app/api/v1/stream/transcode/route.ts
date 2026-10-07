// SSOT Phase 044 — Transcode submit/status proxies (JWT passthrough).
// Canonical: apps/frontend/app/api/v1/stream/transcode/*/route.ts
// - POST /api/v1/stream/transcode (submit) + GET by jobId (status poll).
import { NextResponse } from 'next/server';

function authHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ message: 'Invalid transcode request' }, { status: 400 });
  try {
    const res = await fetch(`${backend}/api/v1/stream/transcode`, { method: 'POST', headers: authHeaders(req), body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Stream service unavailable' }, { status: 503 });
  }
}
