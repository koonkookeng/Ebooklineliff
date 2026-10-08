// SSOT Phase 051 §5.1 — video preview stream proxy (playlist URL + 60s token).
// Canonical: apps/frontend/app/api/v1/preview/video/stream/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const lessonId = new URL(req.url).searchParams.get('lessonId');
  if (!lessonId) return NextResponse.json({ message: 'Missing lesson id' }, { status: 400 });
  const h: Record<string, string> = {};
  const userId = req.headers.get('x-user-id');
  const cookie = req.headers.get('cookie');
  if (userId) h['x-user-id'] = userId;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/preview/video/stream?lessonId=${encodeURIComponent(lessonId)}`,
      { headers: h },
    );
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Preview service unavailable' }, { status: 503 });
  }
}
