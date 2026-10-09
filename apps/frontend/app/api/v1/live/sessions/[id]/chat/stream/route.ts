// SSOT Phase 099 BDD-2 — Live SSE stream proxy (passthrough, no buffering)
// Canonical: apps/frontend/app/api/v1/live/sessions/[id]/chat/stream/route.ts
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const h: Record<string, string> = { Accept: 'text/event-stream' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  const upstream = await fetch(
    `${backend}/api/v1/live/sessions/${encodeURIComponent(params.id)}/chat/stream`,
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
