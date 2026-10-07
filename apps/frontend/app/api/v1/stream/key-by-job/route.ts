// SSOT Phase 044 §8.1 — Transcode key proxy (binary, no-store).
// Canonical: apps/frontend/app/api/v1/stream/key-by-job/route.ts
// - GET ?jobId= → backend DRM gate (JWT + entitlement) → raw AES-128 bytes.
// - Distinct from the Phase 043 videoId+token key route (job-scoped studio keys).
export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const jobId = new URL(req.url).searchParams.get('jobId');
  if (!jobId) return new Response('Missing job id', { status: 400 });
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/stream/key?jobId=${encodeURIComponent(jobId)}`, { headers: h });
    if (!res.ok) return new Response('Key unavailable', { status: res.status });
    const bytes = await res.arrayBuffer();
    return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('Stream service unavailable', { status: 503 });
  }
}
