// SSOT Phase 084 BDD-2 — Magic-link recover proxy (public: token is the auth)
// Canonical: apps/frontend/app/api/v1/abandoned-cart/recover/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const body = await req.json().catch(() => null);
  try {
    const res = await fetch(`${backend}/api/v1/abandoned-cart/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ success: false, message: 'Recovery service unavailable', cartSession: null }, { status: 503 });
  }
}
