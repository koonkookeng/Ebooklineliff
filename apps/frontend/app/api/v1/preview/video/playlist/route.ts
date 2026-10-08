// SSOT Phase 051 §5.1 — preview playlist proxy (trimmed 120s window, no-store).
// Canonical: apps/frontend/app/api/v1/preview/video/playlist/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const lessonId = url.searchParams.get('lessonId');
  const token = url.searchParams.get('token');
  if (!lessonId || !token) {
    return NextResponse.json({ message: 'Missing preview playlist request' }, { status: 400 });
  }
  try {
    const res = await fetch(
      `${backend}/api/v1/preview/video/playlist?lessonId=${encodeURIComponent(lessonId)}&token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return NextResponse.json({ message: 'Playlist unavailable' }, { status: res.status });
    const text = await res.text();
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'application/x-mpegURL', 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ message: 'Preview service unavailable' }, { status: 503 });
  }
}
