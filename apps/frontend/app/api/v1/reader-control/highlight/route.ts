// SSOT Phase 041 — highlight save/delete proxy (see annotations/route.ts header).
import { NextResponse } from 'next/server';

function headersOf(req: Request): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ message: 'Invalid highlight input' }, { status: 400 });
    const res = await fetch(`${backend}/api/v1/reader-control/highlight`, {
      method: 'POST',
      headers: headersOf(req),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Reader service unavailable' }, { status: 503 });
  }
}

export async function DELETE(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const highlightId = new URL(req.url).searchParams.get('highlightId');
  if (!highlightId) return NextResponse.json({ message: 'Missing highlight id' }, { status: 400 });
  try {
    const res = await fetch(`${backend}/api/v1/reader-control/highlight/${encodeURIComponent(highlightId)}`, {
      method: 'DELETE',
      headers: headersOf(req),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Reader service unavailable' }, { status: 503 });
  }
}
