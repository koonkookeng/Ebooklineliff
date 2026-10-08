// SSOT Phase 053 Task 3 — signed-URL proxy (JWT cookie forward, no caching).
// Canonical: apps/frontend/app/api/stream/get-signed-url/route.ts
// - Identity rides the JWT cookie (server stamps userIds; Gate 4).
// - 403/400 pass through untouched so the player can show re-auth UI.
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const lessonId = url.searchParams.get('lessonId') ?? '';
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/stream/get-signed-url?lessonId=${encodeURIComponent(lessonId)}`,
      { headers: h, cache: 'no-store' },
    );
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ success: false, status: 'UNAVAILABLE' }, { status: 503 });
  }
}
