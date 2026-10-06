// SSOT Phase 017 §6 — Top-up bonus preview proxy
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const body = await req.json();
    const res = await fetch(`${backend}/api/wallet/topup/preview-bonus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Wallet service unavailable' }, { status: 503 });
  }
}
