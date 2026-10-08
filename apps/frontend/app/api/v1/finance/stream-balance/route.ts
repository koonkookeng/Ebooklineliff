// SSOT Phase 081 Task 6 — Balance SSE stream proxy (auth passthrough)
// Canonical: apps/frontend/app/api/v1/finance/stream-balance/route.ts
export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const headers: Record<string, string> = { Accept: 'text/event-stream', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) headers['authorization'] = auth;
  if (cookie) headers['cookie'] = cookie;
  try {
    const upstream = await fetch(`${backend}/api/v1/finance/stream-balance`, { headers });
    if (!upstream.ok || !upstream.body) {
      return new Response(JSON.stringify({ message: 'Stream unavailable' }), { status: upstream.status || 503 });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch {
    return new Response(JSON.stringify({ message: 'Finance service unavailable' }), { status: 503 });
  }
}
