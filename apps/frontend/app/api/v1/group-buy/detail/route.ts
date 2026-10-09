// SSOT Phase 090 Task 5 — Group detail proxy (public invite link)
// Canonical: apps/frontend/app/api/v1/group-buy/detail/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const roomId = new URL(req.url).searchParams.get('roomId') ?? '';
  try {
    const res = await fetch(`${backend}/api/v1/group-buy/detail?roomId=${encodeURIComponent(roomId)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Group-buy service unavailable' }, { status: 503 });
  }
}
