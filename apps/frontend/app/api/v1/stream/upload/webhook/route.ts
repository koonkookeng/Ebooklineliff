// SSOT Phase 043 §5.2 — worker webhook proxy (secret passthrough, no JWT).
// Canonical: apps/frontend/app/api/v1/stream/upload/webhook/route.ts
// - The Cloudflare worker calls the backend directly in production; this
//   proxy exists for local/dev routing and forwards X-Worker-Secret untouched.
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ message: 'Invalid worker event' }, { status: 400 });
  const secret = req.headers.get('x-worker-secret') ?? '';
  try {
    const res = await fetch(`${backend}/api/v1/stream/upload/webhook/video-uploaded`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': secret },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Stream service unavailable' }, { status: 503 });
  }
}
