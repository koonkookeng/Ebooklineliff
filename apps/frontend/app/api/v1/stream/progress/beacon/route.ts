// SSOT Phase 046 BDD-2 — Beacon proxy (no-JWT unload flush).
// Canonical: apps/frontend/app/api/v1/stream/progress/beacon/route.ts
// - sendBeacon carries no Authorization header, so identity rides the JSON
//   body {userId, input} (spec §5.2 verbatim) straight to the backend beacon
//   endpoint, which runs the identical anti-cheat pipeline.
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const text = await req.text();
    if (!text) return NextResponse.json({ message: 'Empty beacon' }, { status: 400 });
    const res = await fetch(`${backend}/api/v1/stream/progress/beacon`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: text,
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Stream service unavailable' }, { status: 503 });
  }
}
