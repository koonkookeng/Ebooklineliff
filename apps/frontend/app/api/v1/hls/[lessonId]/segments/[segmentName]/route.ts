// SSOT Phase 050 §5.3 — segment proxy (binary passthrough, rate-guard upstream).
// Canonical: apps/frontend/app/api/v1/hls/[lessonId]/segments/[segmentName]/route.ts
// - Forwards x-user-id so the Redis sliding-window guard keys per viewer;
//   upstream 429s surface with retry-after so the player can back off.
import { NextResponse } from 'next/server';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ lessonId: string; segmentName: string }> },
) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const { lessonId, segmentName } = await ctx.params;
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return NextResponse.json({ message: 'Missing segment token' }, { status: 400 });
  if (!/^[a-zA-Z0-9_\-]+\.(ts|m4s)$/.test(segmentName)) {
    return NextResponse.json({ message: 'Invalid segment name' }, { status: 400 });
  }
  const h: Record<string, string> = {};
  const userId = req.headers.get('x-user-id');
  const cookie = req.headers.get('cookie');
  if (userId) h['x-user-id'] = userId;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/hls/${lessonId}/segments/${segmentName}?token=${encodeURIComponent(token)}`,
      { headers: h },
    );
    if (res.status === 429) {
      return NextResponse.json(
        { message: 'Video segment download rate exceeded', retryAfterSec: 2 },
        { status: 429, headers: { 'Retry-After': '2' } },
      );
    }
    if (!res.ok) return NextResponse.json({ message: 'Segment unavailable' }, { status: res.status });
    const bytes = await res.arrayBuffer();
    const mime = segmentName.endsWith('.m4s') ? 'video/iso-segment' : 'video/MP2T';
    return new Response(bytes, {
      status: 200,
      headers: { 'Content-Type': mime, 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ message: 'Stream service unavailable' }, { status: 503 });
  }
}
