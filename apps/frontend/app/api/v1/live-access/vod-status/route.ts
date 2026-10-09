// SSOT Phase 102 BDD-2 — VOD status proxy (member JWT, 2s poll)
// Canonical: apps/frontend/app/api/v1/live-access/vod-status/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const lessonId = url.searchParams.get('lessonId') ?? '';
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const h: Record<string, string> = { 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/live-access/vod-status?lessonId=${encodeURIComponent(lessonId)}`, { headers: h });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'VOD service unavailable' }, { status: 503 });
  }
}
