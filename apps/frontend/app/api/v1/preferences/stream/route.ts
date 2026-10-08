// SSOT Phase 066 BDD-1 — Preferences SSE stream proxy (fan-out passthrough)
// Canonical: apps/frontend/app/api/v1/preferences/stream/route.ts
// - Pipes the NestJS SSE preference stream to the EventSource provider
//   with event-stream headers preserved (Phase 057 sync/stream precedent).
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const qs = new URL(req.url).search;
  try {
    const upstream = await fetch(`${backend}/api/v1/preferences/stream${qs}`, {
      headers: { accept: 'text/event-stream' },
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ message: 'Preference stream unavailable' }, { status: upstream.status || 503 });
    }
    return new Response(upstream.body, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  } catch {
    return NextResponse.json({ message: 'Preference service unavailable' }, { status: 503 });
  }
}
