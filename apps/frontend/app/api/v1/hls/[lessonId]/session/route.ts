// SSOT Phase 050 §5.3 — stream session bootstrap proxy (JWT cookie forward).
// Canonical: apps/frontend/app/api/v1/hls/[lessonId]/session/route.ts
// - Player renews the short-lived manifest token every 8s via this endpoint.
import { NextResponse } from 'next/server';

export async function POST(req: Request, ctx: { params: Promise<{ lessonId: string }> }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const { lessonId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/hls/${lessonId}/session`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Stream service unavailable' }, { status: 503 });
  }
}
