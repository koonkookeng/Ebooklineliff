// SSOT Phase 041 — Reader-control proxies (JWT passthrough, Phase 014 pattern)
// Canonical: apps/frontend/app/api/v1/reader-control/*/route.ts
// - annotations GET, bookmark POST (toggle), highlight POST/DELETE,
//   preferences GET/PUT → NestJS api/v1/reader-control/*.
// - Non-OK statuses pass through so callers enter ERROR + offline paths.
import { NextResponse } from 'next/server';

function backend(): string {
  return process.env.BACKEND_URL ?? 'http://localhost:4000';
}

function forwardHeaders(req: Request, json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['content-type'] = 'application/json';
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

async function relay(res: Response, fallback: string): Promise<NextResponse> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message ?? `${fallback} (${res.status})`;
    return NextResponse.json({ message }, { status: res.status });
  }
  return NextResponse.json(data, { status: res.status });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const productId = url.searchParams.get('productId');
  if (!productId) return NextResponse.json({ message: 'Missing product id' }, { status: 400 });
  try {
    const res = await fetch(`${backend()}/api/v1/reader-control/annotations?productId=${encodeURIComponent(productId)}`, {
      headers: forwardHeaders(req, false),
    });
    return relay(res, 'Load annotations failed');
  } catch {
    return NextResponse.json({ message: 'Reader service unavailable' }, { status: 503 });
  }
}
