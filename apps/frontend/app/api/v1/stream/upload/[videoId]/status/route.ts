// SSOT Phase 043 — upload status proxy (see initiate/route.ts header).
import { NextResponse } from 'next/server';

export async function GET(req: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const { videoId } = await params;
  if (!videoId) return NextResponse.json({ message: 'Missing video id' }, { status: 400 });
  const h: Record<string, string> = {};
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/stream/upload/${encodeURIComponent(videoId)}/status`, { headers: h });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Stream service unavailable' }, { status: 503 });
  }
}
