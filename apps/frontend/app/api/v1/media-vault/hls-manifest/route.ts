// SSOT Phase 036 Task 6 — Vault HLS manifest proxy (JWT passthrough)
// Canonical: apps/frontend/app/api/v1/media-vault/hls-manifest/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const lessonId = url.searchParams.get('lessonId');
  if (!lessonId) return NextResponse.json({ message: 'Missing lesson id' }, { status: 400 });
  const qs = url.searchParams.toString();
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/media-vault/hls-manifest/${encodeURIComponent(lessonId)}?${qs}`, { headers: h });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Vault service unavailable' }, { status: 503 });
  }
}
