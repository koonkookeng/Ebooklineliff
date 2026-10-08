// SSOT Phase 050 §5.3 — AES-128 rotation key proxy (binary, no-store, never logged).
// Canonical: apps/frontend/app/api/v1/hls/[lessonId]/key/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request, ctx: { params: Promise<{ lessonId: string }> }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const { lessonId } = await ctx.params;
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return NextResponse.json({ message: 'Missing key token' }, { status: 400 });
  const h: Record<string, string> = {};
  const userId = req.headers.get('x-user-id');
  if (userId) h['x-user-id'] = userId;
  try {
    const res = await fetch(
      `${backend}/api/v1/hls/${lessonId}/key?token=${encodeURIComponent(token)}`,
      { headers: h },
    );
    if (!res.ok) return new Response('Key unavailable', { status: res.status });
    const bytes = await res.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ message: 'Stream service unavailable' }, { status: 503 });
  }
}
