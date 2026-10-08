// SSOT Phase 057 §5.2 — Sync SSE stream proxy (room fan-out passthrough)
// Canonical: apps/frontend/app/api/v1/sync/stream/route.ts
// - Pipes the NestJS SSE room stream (GET /api/v1/sync/stream) to the
//   EventSource hook with event-stream headers preserved. Upstream failure
//   surfaces as 503 so the hook enters SYNC_ERROR + offline queue.
export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const qs = new URL(req.url).search;
  try {
    const upstream = await fetch(`${backend}/api/v1/sync/stream${qs}`, {
      headers: { accept: 'text/event-stream' },
    });
    if (!upstream.ok || !upstream.body) {
      const { NextResponse } = await import('next/server');
      return NextResponse.json({ message: 'Sync stream unavailable' }, { status: upstream.status || 503 });
    }
    return new Response(upstream.body, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  } catch {
    const { NextResponse } = await import('next/server');
    return NextResponse.json({ message: 'Sync service unavailable' }, { status: 503 });
  }
}
