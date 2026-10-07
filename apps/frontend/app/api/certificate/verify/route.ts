// SSOT Phase 048 — Certificate verification proxy (public, no auth).
// Canonical: apps/frontend/app/api/certificate/verify/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const { searchParams } = new URL(req.url);
  const certNo = searchParams.get('certNo');

  if (!certNo) {
    return NextResponse.json({ isValid: false, message: 'Missing certificate number' }, { status: 400 });
  }

  try {
    const res = await fetch(`${backend}/api/v1/certificate/verify?certNo=${encodeURIComponent(certNo)}`);
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ isValid: false, message: 'Verification service unavailable' }, { status: 503 });
  }
}