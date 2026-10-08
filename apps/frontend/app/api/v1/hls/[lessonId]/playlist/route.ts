// SSOT Phase 050 §5.3 — dynamic playlist proxy (signed short-lived URLs, no-store).
// Canonical: apps/frontend/app/api/v1/hls/[lessonId]/playlist/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request, ctx: { params: Promise<{ lessonId: string }> }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const { lessonId } = await ctx.params;
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return NextResponse.json({ message: 'Missing playlist token' }, { status: 400 });
  try {
    const res = await fetch(
      `${backend}/api/v1/hls/${lessonId}/playlist.m3u8?token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return NextResponse.json({ message: 'Playlist unavailable' }, { status: res.status });
    const text = await res.text();
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'application/x-mpegURL', 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ message: 'Stream service unavailable' }, { status: 503 });
  }
}
