// SSOT Phase 119 — SSE eviction feed proxy (stream passthrough)
// Canonical: apps/frontend/app/api/v1/security/device/events/route.ts
export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const sessionToken = url.searchParams.get('sessionToken') ?? '';
  const h: Record<string, string> = { Accept: 'text/event-stream', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/security/device/events?sessionToken=${encodeURIComponent(sessionToken)}`,
      { headers: h },
    );
    return new Response(res.body, {
      status: res.status,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch {
    return new Response('data: {"type":"device.events.unavailable"}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
}
