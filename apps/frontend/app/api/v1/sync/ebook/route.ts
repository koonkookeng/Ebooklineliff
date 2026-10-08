// SSOT Phase 057 §3.2 — Ebook sync ingest proxy (throttled POST passthrough)
// Canonical: apps/frontend/app/api/v1/sync/ebook/route.ts
// - Forwards the Zod-gated EbookProgressSync to the NestJS sync gateway
//   (POST /api/v1/sync/ebook). 4xx passes through (no retry storm); 5xx maps
//   the hook to SYNC_ERROR + IndexedDB offline queue.
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const body = await req.json().catch(() => null);
    if (!body?.ebookId || typeof body?.lastPage !== 'number') {
      return NextResponse.json({ message: 'Missing ebook sync identity' }, { status: 400 });
    }
    const res = await fetch(`${backend}/api/v1/sync/ebook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Sync service unavailable' }, { status: 503 });
  }
}
