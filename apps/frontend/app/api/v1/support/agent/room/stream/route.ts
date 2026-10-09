// SSOT Phase 103 — Agent room SSE proxy (passthrough)
// Canonical: apps/frontend/app/api/v1/support/agent/room/stream/route.ts
export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId') ?? '';
  const h: Record<string, string> = { Accept: 'text/event-stream' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  const upstream = await fetch(
    `${backend}/api/v1/support/agent/room/stream?tenantId=${encodeURIComponent(tenantId)}`,
    { headers: h },
  );
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}