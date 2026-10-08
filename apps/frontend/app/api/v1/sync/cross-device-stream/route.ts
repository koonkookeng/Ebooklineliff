// SSOT Phase 070 BDD-1/2 — Cross-device SSE stream proxy (fan-out passthrough)
// Canonical: apps/frontend/app/api/v1/sync/cross-device-stream/route.ts
// - Pipes the NestJS SSE cross-device stream to the EventSource handoff
//   hook (Phase 057 sync/stream proxy precedent, <500ms edge path).
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const qs = new URL(req.url).search;
  try {
    const upstream = await fetch(`${backend}/api/v1/sync/cross-device-stream${qs}`, {
      headers: { accept: 'text/event-stream' },
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ message: 'Cross-device stream unavailable' }, { status: upstream.status || 503 });
    }
    return new Response(upstream.body, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  } catch {
    return NextResponse.json({ message: 'Sync service unavailable' }, { status: 503 });
  }
}
