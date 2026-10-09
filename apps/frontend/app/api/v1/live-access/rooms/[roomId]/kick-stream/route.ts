// SSOT Phase 100 BDD-2 — Kick SSE proxy (passthrough, <2s delivery)
// Canonical: apps/frontend/app/api/v1/live-access/rooms/[roomId]/kick-stream/route.ts
export async function GET(req: Request, { params }: { params: { roomId: string } }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const userId = url.searchParams.get('userId') ?? '';
  const h: Record<string, string> = { Accept: 'text/event-stream' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  const upstream = await fetch(
    `${backend}/api/v1/live-access/rooms/${encodeURIComponent(params.roomId)}/kick-stream?userId=${encodeURIComponent(userId)}`,
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
