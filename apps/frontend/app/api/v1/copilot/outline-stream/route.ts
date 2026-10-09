// SSOT Phase 094 — Outline SSE stream proxy
// Canonical: apps/frontend/app/api/v1/copilot/outline-stream/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const topic = url.searchParams.get('topic') ?? '';
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const h: Record<string, string> = { Accept: 'text/event-stream', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/copilot/outline-stream?topic=${encodeURIComponent(topic)}`, { headers: h });
    if (!res.ok || !res.body) return NextResponse.json({ message: 'Co-pilot stream unavailable' }, { status: res.status });
    return new Response(res.body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch {
    return NextResponse.json({ message: 'Co-pilot stream unavailable' }, { status: 503 });
  }
}
