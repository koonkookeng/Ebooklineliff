// SSOT Phase 056 §6 — Viewport stream-info proxy (adaptive player source)
// Canonical: apps/frontend/app/api/v1/viewport/stream/route.ts
// - Resolves the HLS source for the AdaptiveHlsPlayer via the stream gateway
//   lesson-state (single playback implementation, Phase 045 surface). Maps
//   { hlsUrl | masterManifestUrl } → { hlsStreamUrl } + resume cursor.
// - 404/5xx passes through → player ERROR_FALLBACK with retry.
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const productId = url.searchParams.get('productId');
  const lessonId = url.searchParams.get('lessonId');
  if (!productId) return NextResponse.json({ message: 'Missing stream identity' }, { status: 400 });
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const qs = lessonId
      ? `lessonId=${encodeURIComponent(lessonId)}`
      : `productId=${encodeURIComponent(productId)}`;
    const res = await fetch(`${backend}/api/v1/stream/lesson-state?${qs}`, { headers: h });
    const data = (await res.json().catch(() => null)) as {
      hlsUrl?: string;
      masterManifestUrl?: string;
      hlsStreamUrl?: string;
      lastWatchedSec?: number;
      resumeSec?: number;
    } | null;
    if (!res.ok || !data) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(
      {
        hlsStreamUrl: data.hlsStreamUrl ?? data.hlsUrl ?? data.masterManifestUrl ?? null,
        lastWatchedSec: data.lastWatchedSec ?? data.resumeSec ?? 0,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ message: 'Viewport stream unavailable' }, { status: 503 });
  }
}
