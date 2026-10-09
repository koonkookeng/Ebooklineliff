// SSOT Phase 092 Task 4 — AI SSE stream proxy (streams backend events through)
// Canonical: apps/frontend/app/api/v1/ai/chat-stream/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const productId = url.searchParams.get('productId') ?? '';
  const q = url.searchParams.get('q') ?? '';
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const h: Record<string, string> = { Accept: 'text/event-stream', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/ai/chat-stream?productId=${encodeURIComponent(productId)}&q=${encodeURIComponent(q)}`,
      { headers: h },
    );
    if (!res.ok || !res.body) return NextResponse.json({ message: 'AI stream unavailable' }, { status: res.status });
    return new Response(res.body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch {
    return NextResponse.json({ message: 'AI stream unavailable' }, { status: 503 });
  }
}
