// SSOT Phase 047 — Quiz proxies (JWT passthrough, Phase 014 pattern).
// Canonical: apps/frontend/app/api/v1/quiz/*/route.ts
import { NextResponse } from 'next/server';

function authHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = {};
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
    const res = await fetch(`${backend}/api/v1/quiz/checkpoints?lessonId=${encodeURIComponent(lessonId)}`, {
      headers: authHeaders(req),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Quiz service unavailable' }, { status: 503 });
  }
}
