// SSOT Phase 043 Task 5 — AES-128 key proxy (binary, no-store).
// Canonical: apps/frontend/app/api/v1/stream/key/route.ts
// - Forwards videoId+token; streams raw key bytes with no-store (never
//   logged, never cached) for the HLS keyinfo URI.
export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const videoId = url.searchParams.get('videoId');
  const token = url.searchParams.get('token');
  if (!videoId || !token) {
    return new Response('Missing key request', { status: 400 });
  }
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/stream/key?videoId=${encodeURIComponent(videoId)}&token=${encodeURIComponent(token)}`,
      { headers: h },
    );
    if (!res.ok) return new Response('Key unavailable', { status: res.status });
    const bytes = await res.arrayBuffer();
    return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('Stream service unavailable', { status: 503 });
  }
}
