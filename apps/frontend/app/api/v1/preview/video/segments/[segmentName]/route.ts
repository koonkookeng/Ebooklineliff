// SSOT Phase 051 §8.1 — preview segment proxy (binary, token verified upstream).
// Canonical: apps/frontend/app/api/v1/preview/video/segments/[segmentName]/route.ts
import { NextResponse } from 'next/server';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ segmentName: string }> },
) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const { segmentName } = await ctx.params;
  const url = new URL(req.url);
  const lessonId = url.searchParams.get('lessonId');
  const token = url.searchParams.get('token');
  if (!lessonId || !token) {
    return NextResponse.json({ message: 'Missing preview segment request' }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_\-]+\.(ts|m4s)$/.test(segmentName)) {
    return NextResponse.json({ message: 'Invalid segment name' }, { status: 400 });
  }
  try {
    const res = await fetch(
      `${backend}/api/v1/preview/video/segments/${segmentName}?lessonId=${encodeURIComponent(lessonId)}&token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return NextResponse.json({ message: 'Segment unavailable' }, { status: res.status });
    const bytes = await res.arrayBuffer();
    const mime = segmentName.endsWith('.m4s') ? 'video/iso-segment' : 'video/MP2T';
    return new Response(bytes, {
      status: 200,
      headers: { 'Content-Type': mime, 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ message: 'Preview service unavailable' }, { status: 503 });
  }
}
