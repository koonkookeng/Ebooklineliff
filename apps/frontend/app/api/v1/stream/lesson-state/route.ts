// SSOT Phase 045 — Lesson-state/progress proxies (JWT passthrough).
// Canonical: apps/frontend/app/api/v1/stream/lesson-state|lesson-progress/route.ts
import { NextResponse } from 'next/server';

function authHeaders(req: Request, json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['content-type'] = 'application/json';
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const lessonId = new URL(req.url).searchParams.get('lessonId');
  if (!lessonId) return NextResponse.json({ message: 'Missing lesson id' }, { status: 400 });
  try {
    const res = await fetch(`${backend}/api/v1/stream/lesson-state?lessonId=${encodeURIComponent(lessonId)}`, {
      headers: authHeaders(req, false),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Stream service unavailable' }, { status: 503 });
  }
}
